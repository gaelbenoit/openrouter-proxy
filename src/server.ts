  import { createServer, IncomingMessage, ServerResponse } from 'http';
  import * as https from 'https';
  import * as fs from 'fs';
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
      if (req.url === '/dashboard/reset' && req.method === 'POST') {
        return resetDashboardCounters(res, keyManager);
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

  function serveStaticFile(res: ServerResponse, filePath: string, contentType: string): void {
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
        return;
      }

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  }

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
    serveStaticFile(res, './public/dashboard.html', 'text/html; charset=utf-8');
  }

  /**
   * Renvoie le code JavaScript qui réalise le polling périodique de /stats
   * et met à jour l’affichage.
   */
  function serveDashboardJs(res: ServerResponse): void {
    serveStaticFile(res, './public/dashboard.js', 'application/javascript; charset=utf-8');
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

  /**
   * Handle POST request to reset daily counters for all keys
   */
  function resetDashboardCounters(res: ServerResponse, keyMgr: KeyManager): void {
    keyMgr.resetAllDailyCounters();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Daily counters reset successfully' }));
  }

// Only start the server if this file is run directly (not when imported as a module)
if (require.main === module) {
  server.listen(config.port, config.host, () => {
    logger.info(`OpenRouter Proxy listening on ${config.host}:${config.port}`);
  });
}

export default server;