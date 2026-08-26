import { GET } from '../route';
import { saveShopifyInstallation } from '@/lib/store-configs';
import { ensureAppUninstalledWebhook } from '@/lib/shopify-webhooks';

const mockRedirectResponse = {
  status: 307,
  headers: new Headers(),
  cookies: { set: jest.fn() },
};

jest.mock('next/server', () => ({
  NextResponse: {
    redirect: jest.fn((url: URL) => {
      mockRedirectResponse.headers.set('location', url.toString());
      return mockRedirectResponse;
    }),
  },
}));

jest.mock('@/lib/store-configs', () => ({
  saveShopifyInstallation: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/shopify-webhooks', () => ({
  ensureAppUninstalledWebhook: jest.fn().mockResolvedValue(false),
}));

jest.mock('@/lib/shopify-shop', () => ({
  getShopifyShopMetadata: jest.fn().mockResolvedValue({ name: 'Demo Store', currency: 'CAD' }),
}));

jest.mock('@/lib/admin-auth', () => ({
  ADMIN_SESSION_COOKIE: 'omni_admin_session',
  ADMIN_SESSION_MAX_AGE: 3600,
  createAdminSession: jest.fn(() => 'admin-session'),
}));

jest.mock('@/lib/shopify-oauth', () => ({
  normalizeShopDomain: jest.fn(() => 'demo-store.myshopify.com'),
  requestedShopifyScopes: jest.fn(() => 'read_products'),
  shopifyOAuthConfig: jest.fn(() => ({
    appUrl: 'https://app.example.com',
    clientId: 'client-id',
    clientSecrets: ['client-secret'],
  })),
  verifyShopifyCallbackHmac: jest.fn(() => true),
  verifyShopifyOAuthState: jest.fn(() => true),
}));

describe('Shopify installation callback', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  const originalResponse = global.Response;

  beforeAll(() => {
    if (!global.Response) {
      global.Response = class TestResponse {
        status: number;

        constructor(_body?: BodyInit | null, init?: ResponseInit) {
          this.status = init?.status || 200;
        }
      } as unknown as typeof Response;
    }
  });

  afterAll(() => {
    global.Response = originalResponse;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('creates a store-scoped admin session without the optional global admin backend', async () => {
    delete process.env.ADMIN_CONFIG_TOKEN;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'shop-token', scope: 'read_products' }),
    }) as unknown as typeof fetch;

    const request = {
      nextUrl: new URL('https://app.example.com/api/auth/shopify/callback?shop=demo-store.myshopify.com&code=oauth-code&state=state&hmac=hmac'),
    } as never;
    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://app.example.com/admin/stores?shop=demo-store.myshopify.com&installed=1'
    );
    expect(mockRedirectResponse.cookies.set).toHaveBeenCalledWith(
      'omni_admin_session',
      'admin-session',
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'none' })
    );
    expect(ensureAppUninstalledWebhook).toHaveBeenCalled();
    expect(saveShopifyInstallation).toHaveBeenCalled();
    expect(saveShopifyInstallation).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Demo Store',
      currency: 'CAD',
    }));
    expect((ensureAppUninstalledWebhook as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (saveShopifyInstallation as jest.Mock).mock.invocationCallOrder[0]
    );
  });

  it('does not persist credentials when uninstall revocation cannot be registered', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (ensureAppUninstalledWebhook as jest.Mock).mockRejectedValueOnce(new Error('webhook unavailable'));
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'shop-token', scope: 'read_products' }),
    }) as unknown as typeof fetch;

    const request = {
      nextUrl: new URL('https://app.example.com/api/auth/shopify/callback?shop=demo-store.myshopify.com&code=oauth-code&state=state&hmac=hmac'),
    } as never;
    const response = await GET(request);

    expect(response.status).toBe(500);
    expect(saveShopifyInstallation).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
