import { Server as HttpServer, request as httpRequest } from 'http';

describe('OpenRouter Proxy Server', () => {
  let httpServer: HttpServer;
  let port: number;

  beforeAll((done) => {
    process.env.API_KEYS = 'test-key';
    jest.resetModules();
    const serverModule = require('../src/server');
    httpServer = serverModule.default as HttpServer;
    httpServer.listen(0, '127.0.0.1', () => {
      port = (httpServer.address() as any).port;
      done();
    });
  });

  afterAll((done) => {
    httpServer.close(() => {
      done();
    });
  });

  it('should respond to a request without internal server error (status < 500 from proxy)', (done) => {
    const options = {
      port,
      host: '127.0.0.1',
      path: '/',
      method: 'GET'
    };

    const req = httpRequest(options, (res) => {
      // We consider the test passed if we get a response and the status code is not 500 (or 5xx from our own server error)
      // Note: the upstream might return 502, 503, 401, etc., which are okay because they mean the proxy is working.
      // We only want to catch 500 errors that indicate an unhandled exception in our proxy.
      expect(res.statusCode).toBeLessThan(500);
      // Consume the response body to avoid hanging
      res.resume();
      done();
    });

    req.on('error', (err) => {
      done(err);
    });

    req.end();
  });
});