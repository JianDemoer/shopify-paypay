import { GET } from '../route';

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

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('does not require the optional admin configuration backend', async () => {
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
      'https://app.example.com/install?shop=demo-store.myshopify.com&installed=1'
    );
    expect(mockRedirectResponse.cookies.set).not.toHaveBeenCalled();
  });
});
