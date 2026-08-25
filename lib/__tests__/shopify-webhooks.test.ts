import { ensureAppUninstalledWebhook } from '../shopify-webhooks';

describe('Shopify webhook registration', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    if (originalFetch) global.fetch = originalFetch;
    else delete (global as { fetch?: typeof fetch }).fetch;
  });

  it('does not create a duplicate uninstall webhook', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { webhookSubscriptions: { nodes: [{ uri: 'https://app.example/api/webhooks/shopify' }] } } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(ensureAppUninstalledWebhook({
      shopDomain: 'demo.myshopify.com',
      accessToken: 'token',
      callbackUrl: 'https://app.example/api/webhooks/shopify',
    })).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('creates the uninstall webhook when it is missing', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { webhookSubscriptions: { nodes: [] } } }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: { webhookSubscriptionCreate: { webhookSubscription: { id: 'gid://shopify/WebhookSubscription/1' }, userErrors: [] } },
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(ensureAppUninstalledWebhook({
      shopDomain: 'demo.myshopify.com',
      accessToken: 'token',
      callbackUrl: 'https://app.example/api/webhooks/shopify',
    })).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
