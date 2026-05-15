  import { createServer, IncomingMessage, ServerResponse } from 'http';
  import * as https from 'https';
  import { loadConfig } from './config';
  import { Router } from './router';
  import { HeaderManager } from './headerManager';
  import { KeyManager } from './keyManager';
  import { RequestBodyProcessor } from './requestBodyProcessor';
  import { SSEProcessor } from './sseProcessor';
  import { logger } from './logger';
  import { IncomingRequest } from './types';

const config = loadConfig();

const router = new Router({ targetBasePath: '/api/v1' });
const headerManager = new HeaderManager(config);
const keyManager = new KeyManager(config);
const requestBodyProcessor = new RequestBodyProcessor();
const sseProcessor = new SSEProcessor({
  claudeCodeUserAgents: ['claude-vscode'],
  signatureValue: 'dd9960d18582b741463f3ba1347853ee2ad01144306d9b1e07fd45808d81b171'
});

// Track the current API key to reuse across requests until it fails
let currentApiKey: string | null = null;
// Track daily usage stats for logging/monitoring
let dailyStats: { [key: string]: number } = {};

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // Log incoming request
  logger.request(`Incoming ${req.method} ${req.url}`, {
    method: req.method,
    url: req.url,
    headers: req.headers
  });

   // ------------------- 1️⃣  Gestion du dashboard -------------------
    if (isDashboardRequest(req)) {
      if (req.url === '/' && req.method === 'GET') {
        return serveDashboardHtml(res);
      }
      if (req.url === '/dashboard.js' && req.method === 'GET') {
        return serveDashboardJs(res);
      }
      if (req.url === '/stats' && req.method === 'GET') {
        return serveDashboardStats(res, keyManager);
      }
      // Si le chemin correspond à un préfixe connu mais pas à une route implémentée
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }

    // ------------------- 2️⃣  Traitement normal du proxy -------------------
    // (le reste du code actuel de la fonction reste inchangé)
    // ...

  try {
    // 1. Read request body
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const bodyBuffer = Buffer.concat(chunks);

    // 2. Create incoming request object for processing
    // Convert headers to Record<string, string> (handle possible string[] values)
    const headers: Record<string, string> = {};
    Object.keys(req.headers).forEach(key => {
      const value = req.headers[key];
      if (Array.isArray(value)) {
        headers[key] = value[0];
      } else {
        headers[key] = value ?? '';
      }
    });

    const incomingRequest: IncomingRequest = {
      method: req.method!, // req.method is always defined in IncomingMessage
      url: req.url!,       // req.url is always defined in IncomingMessage
      headers,
      body: bodyBuffer.length > 0 ? bodyBuffer : null
    };

    // 3. Rewrite path
    const processedRequest = router.processRequest(incomingRequest);
    logger.proxy(`Path rewritten: ${incomingRequest.url} → ${processedRequest.url}`);

    // 4. Process request body (mixed message separation, etc.)
    const processedBody = await requestBodyProcessor.processRequestBody(processedRequest);
    logger.proxy(`Body processing complete, shouldProcessMixedMessages: ${processedBody.shouldProcessMixedMessages}`);

    // 5. Get API key - reuse current key if usable, otherwise get a new one
    let apiKey: string | null = null;
    if (currentApiKey !== null && keyManager.isKeyUsable(currentApiKey)) {
      apiKey = currentApiKey;
    } else {
      apiKey = keyManager.getNextKey();
      if (!apiKey) {
        logger.errorLog('No active API keys available');
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No active API keys available' }));
        return;
      }
      currentApiKey = apiKey;
    }

    // 6. Prepare outgoing headers
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
    const originalHost = (req.headers['host'] as string) || '';
    const outgoingHeaders = headerManager.processRequestHeaders(
      processedBody.headers,
      clientIp,
      originalHost
    );
    // Override Authorization with the selected key
    outgoingHeaders['authorization'] = `Bearer ${apiKey}`;

    // 7. Prepare outgoing options
    const targetUrl = `${config.targetProtocol}://${config.targetHost}:${config.targetPort}${processedBody.url}`;
    logger.proxy(`Forwarding to ${targetUrl}`);

    // 8. Make outgoing request
    const outgoingRequest = https.request(targetUrl, {
      method: processedBody.method,
      headers: outgoingHeaders
    }, (proxyRes: IncomingMessage) => {
      // Log outgoing response headers
      logger.proxy(`Received response status: ${proxyRes.statusCode}`);

      // 9. Process response headers (especially for SSE)
      const isSse = (proxyRes.headers['content-type'] as string | undefined)?.includes('text/event-stream') || false;
      const isClaudeCode = (req.headers['user-agent'] as string | undefined)?.includes('claude-vscode') || false;

      // Convert proxyRes.headers to Record<string, string>
      const proxyHeaders: Record<string, string> = {};
      Object.keys(proxyRes.headers).forEach(key => {
        const value = proxyRes.headers[key];
        if (Array.isArray(value)) {
          proxyHeaders[key] = value[0];
        } else {
          proxyHeaders[key] = value ?? '';
        }
      });

      const processedResponseHeaders = headerManager.processResponseHeaders(
        proxyHeaders,
        isSse,
        isClaudeCode
      );

      // 10. Prepare to collect response body (we'll buffer for non-SSE, or process stream for SSE)
      let responseChunks: Buffer[] = [];
      proxyRes.on('data', (chunk: Buffer) => {
        responseChunks.push(chunk);
      });

      proxyRes.on('end', () => {
        const responseBody = Buffer.concat(responseChunks);

        // 11. If SSE, process the stream using our SSE processor
        let finalBody = responseBody;
        if (isSse && isClaudeCode) {
          // Process the collected response body with our SSE processor
          const processed = sseProcessor.processSseStream(responseBody, incomingRequest);
          if (processed !== null && processed !== undefined) {
            // Convert to Buffer to avoid type issues with Buffer<ArrayBufferLike> vs Buffer<ArrayBuffer>
            finalBody = Buffer.from(processed as Buffer);
          }
          logger.sse('SSE response processed for Claude Code client', {
            statusCode: proxyRes.statusCode,
            contentType: proxyRes.headers['content-type'] as string
          });
        }

        // 12. Mark key as successful or failed based on status code
        const statusCode = proxyRes.statusCode ?? 502;
        if (statusCode >= 400 && statusCode !== 429 && statusCode !== 400) {
          keyManager.markKeyFailed(apiKey);
          logger.errorLog(`Upstream error ${statusCode} for key ${keyManager.getKeyDescription(apiKey)}`);
          // Keep currentApiKey; it will be deactivated if failure count exceeds threshold
        } else if (statusCode === 429) {
          keyManager.markKeyRateLimited(apiKey);
          logger.warn(`Rate limit (429) for key ${keyManager.getKeyDescription(apiKey)}`);
          // Rotate to a new key on next request
          currentApiKey = null;
        } else if (statusCode === 400) {
          // OpenRouter bug: 400 errors should not affect key status
          logger.errorLog(`Upstream error ${statusCode} (OpenRouter bug) for key ${keyManager.getKeyDescription(apiKey)}`);
        } else {
          keyManager.markKeySuccessful(apiKey);
          logger.keyManagement(`Successful request with key ${keyManager.getKeyDescription(apiKey)}`);
          // Keep currentApiKey for next request
        }

        // 13. Send response back to client
        res.writeHead(statusCode, processedResponseHeaders);
        res.end(finalBody);
      });

      proxyRes.on('error', (err: unknown) => {
        if (err instanceof Error) {
          logger.errorLog(`Error proxying response: ${err.message}`);
        } else {
          logger.errorLog(`Error proxying response: ${String(err)}`, {});
        }
        if (!res.writableEnded) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Bad Gateway' }));
        }
      });
    });

    outgoingRequest.on('error', (err: Error) => {
      logger.errorLog(`Error making outgoing request: ${err.message}`);
      if (!res.writableEnded) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad Gateway' }));
      }
    });

    // 14. Write request body to outgoing request (if any)
    if (processedBody.body) {
      outgoingRequest.write(processedBody.body);
    }
    outgoingRequest.end();

  } catch (err: unknown) {
    if (err instanceof Error) {
      logger.errorLog(`Unexpected error processing request: ${err.message}`, { stack: err.stack });
    } else {
      logger.errorLog(`Unexpected error processing request: ${String(err)}`, {});
    }
    if (!res.writableEnded) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  }
});

  /**
   * Retourne vrai si la requête doit être traitée comme une demande de dashboard
   * (HTML, JS ou JSON) plutôt que comme une requête à proxyer vers OpenRouter.
   */
  function isDashboardRequest(req: IncomingMessage): boolean {
    const url = req.url ?? '';

    // 1️⃣  Les chemins réservés au dashboard
    if (url === '/' || url.startsWith('/dashboard') || url.startsWith('/stats')) {
      return true;
    }

    // 2️⃣  Optionnel : si le client accepte explicitement du HTML, on sert le dashboard
    const accept = req.headers['accept']?.toString() ?? '';
    if (accept.includes('text/html')) return true;

    // 3️⃣  Optionnel : on peut aussi regarder le User‑Agent pour distinguer un navigateur
    //    des clients OpenRouter (curl, Postman, etc.). Ceci reste facultatif.
    const ua = (req.headers['user-agent'] ?? '').toLowerCase();
    return (
      ua.includes('mozilla') ||
      ua.includes('chrome') ||
      ua.includes('safari') ||
      ua.includes('edge')
    );
  }
  /**
   * Renvoie la petite page HTML qui charge le script du dashboard.
   */
  function serveDashboardHtml(res: ServerResponse): void {
    const html = `
  <!DOCTYPE html>
  <html lang="fr">
  <head>
    <meta charset="UTF-8">
    <title>OpenRouter Proxy – Dashboard</title>
    <style>
      body {font-family: Arial, sans-serif; margin: 20px; background:#f9f9f9;}
      h1 {color:#333;}
      .key-bar {margin: 10px 0;}
      .label {font-weight:bold; display:inline-block; width:250px;}
      .bar {background:#e0e0e0; height:20px; width:300px; display:inline-block; position:relative;}
      .fill {height:100%; background:green; transition:background .2s;}
      .tooltip {position:absolute; background:#333; color:#fff; padding:5px;
                border-radius:3px; white-space:nowrap; font-size:12px;
                bottom:120%; left:50%; transform:translateX(-50%);
                opacity:0; pointer-events:none; transition:opacity .2s;}
      .bar:hover .tooltip {opacity:1;}
    </style>
  </head>
  <body>
    <h1>Dashboard – Utilisation des clés API</h1>
    <div id="keys"></div>

    <script src="/dashboard.js"></script>
  </body>
  </html>
    `.trim();

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  /**
   * Renvoie le code JavaScript qui réalise le polling périodique de /stats
   * et met à jour l’affichage.
   */
  function serveDashboardJs(res: ServerResponse): void {
    const js =
      "// Fonction utilitaire pour convertir une chaîne ISO en date locale lisible\n" +
      "function fmtDate(iso) {\n" +
      "  if (!iso) return '―';\n" +
      "  const d = new Date(iso);\n" +
      "  return d.toLocaleString();\n" +
      "}\n\n" +
      "// Détermine la couleur de la barre en fonction du statut\n" +
      "function getBarColor(info) {\n" +
      "  if (!info.isActive) return '#bbb';               // gris – inactif\n" +
      "  if (info.cooldownUntil) return '#4a90e2';        // bleu – en cooldown\n" +
      "  // Dégradation du vert → jaune → rouge en fonction de dayCount / 50\n" +
      "  const ratio = Math.min(info.dayCount / 50, 1);   // 0 → 1\n" +
      "  if (ratio < 0.5) {\n" +
      "    // vert → jaune\n" +
      "    const r = Math.round(128 + 127 * (ratio * 2)); // 128 à 255 (vert à jaune)\n" +
      "    const g = 255;\n" +
      "    return 'rgb(' + r + ',' + g + ',0)';\n" +
      "  } else {\n" +
      "    // jaune → rouge\n" +
      "    const r = 255;\n" +
      "    const g = Math.round(255 * (2 - ratio * 2));  // 255 à 0\n" +
      "    return 'rgb(' + r + ',' + g + ',0)';\n" +
      "  }\n" +
      "}\n\n" +
      "// Met à jour le tableau avec les données reçues\n" +
      "async function refresh() {\n" +
      "  try {\n" +
      "    const resp = await fetch('/stats');\n" +
      "    const data = await resp.json();\n" +
      "    const container = document.getElementById('keys');\n" +
      "    container.innerHTML = ''; // nettoyer\n\n" +
      "    data.forEach(info => {\n" +
      "      const div = document.createElement('div');\n" +
      "      div.className = 'key-bar';\n\n" +
      "      const label = document.createElement('div');\n" +
      "      label.className = 'label';\n" +
      "      label.textContent = info.label;\n" +
      "      div.appendChild(label);\n\n" +
      "      const bar = document.createElement('div');\n" +
      "      bar.className = 'bar';\n" +
      "      const fill = document.createElement('div');\n" +
      "      fill.className = 'fill';\n" +
      "      fill.style.width = (info.dayCount / 50) * 100 + '%';\n" +
      "      fill.style.background = getBarColor(info);\n\n" +
      "      bar.appendChild(fill);\n\n" +
      "      const tooltip = document.createElement('div');\n" +
      "      tooltip.className = 'tooltip';\n" +
      "      tooltip.innerHTML = '<strong>Clé :</strong>' + info.label + '<br><strong>Description :</strong>' + (info.description || '―') + '<br><strong>Actif :</strong>' + (info.isActive ? 'Oui' : 'Non') + '<br><strong>Utilisation aujourd\\'hui :</strong>' + info.dayCount + '<br><strong>Échecs aujourd\\'hui :</strong>' + info.failureCount + '<br><strong>Cooldown jusqu\\'à :</strong>' + fmtDate(info.cooldownUntil) + '<br><strong>Dernière utilisation :</strong>' + fmtDate(info.lastUsed) + '<br><strong>Dernier échec :</strong>' + fmtDate(info.lastFailure);\n\n" +
      "      bar.appendChild(tooltip);\n\n" +
      "      div.appendChild(bar);\n" +
      "      container.appendChild(div);\n" +
      "    });\n" +
      "  } catch (e) {\n" +
      "    console.error('Erreur lors du rafraîchissement du dashboard :', e);\n" +
      "  }\n" +
      "}\n\n" +
      "// Rafraîchissement initial puis toutes les 5 secondes\n" +
      "refresh();\n" +
      "setInterval(refresh, 5000);";

    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    res.end(js);
  }

  /**
   * Renvoie le JSON contenant les informations de chaque clé, en utilisant
   * getKeyLabel pour obtenir la forme courte à afficher.
   */
  function serveDashboardStats(res: ServerResponse, keyMgr: KeyManager): void {
    const info = keyMgr.getDashboardInfo();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(info));
  }

// Only start the server if this file is run directly (not when imported as a module)
if (require.main === module) {
  server.listen(config.port, config.host, () => {
    logger.info(`OpenRouter Proxy listening on ${config.host}:${config.port}`);
  });
}

export default server;