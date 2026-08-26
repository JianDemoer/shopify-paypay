import { getShopifyShopMetadata } from '../shopify-shop';

describe('Shopify shop metadata', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('loads the installed shop name and currency through Admin GraphQL', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { shop: { name: 'Demo Store', currencyCode: 'cad' } } }),
    }) as unknown as typeof fetch;

    await expect(getShopifyShopMetadata({
      shopDomain: 'demo.myshopify.com',
      accessToken: 'token',
    })).resolves.toEqual({ name: 'Demo Store', currency: 'CAD' });
  });

  it('rejects incomplete metadata instead of silently using the wrong currency', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { shop: { name: 'Demo Store' } } }),
    }) as unknown as typeof fetch;

    await expect(getShopifyShopMetadata({
      shopDomain: 'demo.myshopify.com',
      accessToken: 'token',
    })).rejects.toThrow('incomplete shop metadata');
  });
});
