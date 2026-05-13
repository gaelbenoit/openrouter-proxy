import { Router } from '../src/router';

describe('Router', () => {
  let router: Router;

  beforeEach(() => {
    router = new Router({ targetBasePath: '/api/v1' });
  });

  it('should rewrite /v1/models to /api/v1/models', () => {
    const request = {
      method: 'GET',
      url: '/v1/models',
      headers: {},
      body: null
    };

    const result = router.processRequest(request);
    expect(result.url).toBe('/api/v1/models');
  });

  it('should rewrite /v1 to /api/v1', () => {
    const request = {
      method: 'GET',
      url: '/v1',
      headers: {},
      body: null
    };

    const result = router.processRequest(request);
    expect(result.url).toBe('/api/v1');
  });

  it('should not rewrite paths that do not start with /v1', () => {
    const request = {
      method: 'GET',
      url: '/health',
      headers: {},
      body: null
    };

    const result = router.processRequest(request);
    expect(result.url).toBe('/health');
  });

  it('should not rewrite paths that start with /v1 but have no trailing slash after v1 (like /v1test)', () => {
    const request = {
      method: 'GET',
      url: '/v1test',
      headers: {},
      body: null
    };

    const result = router.processRequest(request);
    expect(result.url).toBe('/v1test'); // Should not be rewritten
  });
});