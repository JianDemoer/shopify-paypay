import { resolveCheckoutLineItems } from '../shopify-admin';
import type { StoreConfig } from '../store-configs';

const config = {
  shopDomain: 'test-store.myshopify.com',
  shopifyAdminAccessToken: 'shpat_test',
} as StoreConfig;

describe('Shopify checkout item resolver', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('uses the Shopify variant price instead of the browser price', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          productVariant: {
            id: 'gid://shopify/ProductVariant/1',
            title: 'Default Title',
            price: '29.97',
            product: { id: 'gid://shopify/Product/1', title: 'Pen' },
            image: { url: 'https://example.com/pen.jpg' },
          },
        },
      }),
    });

    const [item] = await resolveCheckoutLineItems(config, {
      variantId: 'gid://shopify/ProductVariant/1',
      quantity: 1,
      price: 1,
      title: 'Client supplied price',
    });

    expect(item.price).toBe(29.97);
    expect(item.title).toBe('Pen');
    expect(item.variantId).toBe('gid://shopify/ProductVariant/1');
  });
});
