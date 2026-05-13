import { createServer } from 'http';
import { loadConfig } from './config';

const config = loadConfig();

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OpenRouter Proxy is running!\n');
});

server.listen(config.port, config.host, () => {
  console.log(`OpenRouter Proxy listening on ${config.host}:${config.port}`);
});

export default server;