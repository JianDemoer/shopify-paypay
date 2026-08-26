import { completeShopifyDraftOrder, createShopifyDraftOrder, createShopifyOrder, resolveCheckoutLineItems } from '../shopify-admin';
import type { StoreConfig } from '../store-configs';

const config = {
  id: 'test-store.myshopify.com',
  shopDomain: 'test-store.myshopify.com',
  shopifyAdminAccessToken: 'shpat_test',
  currency: 'USD',
} as StoreConfig;

const address = {
  firstName: 'Test',
  lastName: 'Buyer',
  address1: '100 Main St',
  city: 'Austin',
  province: 'TX',
  zip: '78701',
  country: 'US',
};

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
            price: { amount: '29.97', currencyCode: 'USD' },
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
    const request = (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
    expect(String(request.body)).toContain('price { amount currencyCode }');
  });

  it('creates draft orders through GraphQL with exact price overrides and fixed tax', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { draftOrders: { nodes: [] } } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { draftOrderCreate: { draftOrder: { id: 'gid://shopify/DraftOrder/10', invoiceUrl: 'https://invoice.example' }, userErrors: [] } } }),
      });

    const result = await createShopifyDraftOrder({
      storeConfig: config,
      draftKey: 'session-1:main',
      email: 'buyer@example.com',
      firstName: 'Test',
      lastName: 'Buyer',
      lineItems: [{ variantId: 'gid://shopify/ProductVariant/1', quantity: 1, title: 'Pen', price: 19.99 }],
      shippingAddress: address,
      shippingPrice: 4,
      taxPrice: 1.2,
    });

    expect(result.id).toBe('gid://shopify/DraftOrder/10');
    const createRequest = JSON.parse(String((global.fetch as jest.Mock).mock.calls[1][1].body));
    expect(createRequest.query).toContain('draftOrderCreate');
    expect(createRequest.variables.input).toEqual(expect.objectContaining({
      taxExempt: true,
      presentmentCurrencyCode: 'USD',
      shippingLine: expect.objectContaining({ priceWithCurrency: { amount: '4.00', currencyCode: 'USD' } }),
    }));
    expect(createRequest.variables.input.lineItems).toEqual([
      expect.objectContaining({ variantId: 'gid://shopify/ProductVariant/1', priceOverride: { amount: '19.99', currencyCode: 'USD' } }),
      expect.objectContaining({ title: 'Tax', originalUnitPriceWithCurrency: { amount: '1.20', currencyCode: 'USD' }, taxable: false }),
    ]);
  });

  it('completes an existing draft through GraphQL and returns the Shopify order number', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { draftOrder: { id: 'gid://shopify/DraftOrder/10', status: 'OPEN', order: null } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { draftOrder: { id: 'gid://shopify/DraftOrder/10', status: 'OPEN', order: null } } }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { draftOrderComplete: { draftOrder: { id: 'gid://shopify/DraftOrder/10', status: 'COMPLETED', order: { id: 'gid://shopify/Order/20', name: '#1042' } }, userErrors: [] } } }),
      });

    await expect(completeShopifyDraftOrder({ storeConfig: config, draftOrderId: '10' })).resolves.toEqual({
      id: 'gid://shopify/Order/20',
      order_number: 1042,
    });
    const completionRequest = JSON.parse(String((global.fetch as jest.Mock).mock.calls[2][1].body));
    expect(completionRequest.query).toContain('draftOrderComplete');
    expect(completionRequest.variables.id).toBe('gid://shopify/DraftOrder/10');
  });

  it('creates direct orders through GraphQL with a matching external transaction', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { orders: { nodes: [] } } }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { orderCreate: { order: { id: 'gid://shopify/Order/30', name: '#1043', tags: [] }, userErrors: [] } } }),
      });

    const order = await createShopifyOrder({
      storeConfig: config,
      email: 'buyer@example.com',
      firstName: 'Test',
      lastName: 'Buyer',
      lineItems: [{ variantId: 'gid://shopify/ProductVariant/1', productId: 'gid://shopify/Product/1', quantity: 2, title: 'Pen', price: 10 }],
      shippingAddress: address,
      paymentIntentId: 'pi_123',
      shippingPrice: 4,
      taxPrice: 1.2,
      taxRate: 0.06,
    });

    expect(order).toEqual({ id: 'gid://shopify/Order/30', order_number: 1043 });
    const createRequest = JSON.parse(String((global.fetch as jest.Mock).mock.calls[1][1].body));
    expect(createRequest.query).toContain('orderCreate');
    expect(createRequest.variables.order.transactions[0]).toEqual(expect.objectContaining({
      gateway: 'Stripe',
      authorizationCode: 'pi_123',
      amountSet: { shopMoney: { amount: '25.20', currencyCode: 'USD' } },
    }));
    expect(createRequest.variables.options.inventoryBehaviour).toBe('DECREMENT_IGNORING_POLICY');
  });
});
