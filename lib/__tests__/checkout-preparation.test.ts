jest.mock('../checkout-sessions', () => ({
  acquireCheckoutLock: jest.fn(),
  getCheckoutSession: jest.fn(),
  releaseCheckoutLock: jest.fn(),
  updateCheckoutSession: jest.fn(),
}));

jest.mock('../shopify-admin', () => ({
  createShopifyDraftOrder: jest.fn(),
  updateShopifyDraftOrder: jest.fn(),
}));

import { prepareCheckoutSession } from '../checkout-preparation';
import {
  acquireCheckoutLock,
  getCheckoutSession,
  releaseCheckoutLock,
  updateCheckoutSession,
} from '../checkout-sessions';
import { createShopifyDraftOrder, updateShopifyDraftOrder } from '../shopify-admin';
import type { CheckoutSession } from '../checkout-sessions';
import type { StoreConfig } from '../store-configs';

const store = {
  id: 'test.myshopify.com',
  shopDomain: 'test.myshopify.com',
  currency: 'USD',
  standardShipping: 4,
  expressShipping: 9,
  taxRate: 0.1,
} as StoreConfig;

const session = {
  id: 'opc_test',
  storeId: store.id,
  shopDomain: store.shopDomain,
  cid: 'cid_test',
  currency: 'USD',
  items: [{ id: 'line-1', variantId: 'gid://shopify/ProductVariant/1', title: 'Pen', quantity: 2, price: 20 }],
  subtotal: 40,
  shipping: 4,
  tax: 4,
  total: 48,
  checkoutStatus: 'open',
  createdAt: '2026-08-26T00:00:00.000Z',
  expiresAt: '2026-09-02T00:00:00.000Z',
} as CheckoutSession;

const customer = {
  email: 'buyer@example.com',
  firstName: 'Test',
  lastName: 'Buyer',
  address1: '100 Main Street',
  city: 'Austin',
  province: 'TX',
  country: 'US',
  zip: '78701',
};

describe('checkout preparation', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (acquireCheckoutLock as jest.Mock).mockResolvedValue('lock-token');
    (getCheckoutSession as jest.Mock).mockResolvedValue({ ...session });
    (createShopifyDraftOrder as jest.Mock).mockResolvedValue({ id: 'gid://shopify/DraftOrder/10' });
    (updateCheckoutSession as jest.Mock).mockImplementation(async (_id, patch) => ({ ...session, ...patch }));
  });

  it('persists server-calculated contact, shipping, and a Draft Order without payment setup', async () => {
    const result = await prepareCheckoutSession(session.id, store, {
      customer,
      shippingMethod: 'express',
      sourceUrl: 'https://example.com/a/s/checkout/opc_test/entry?checkout_token=secret&cid=abc',
    });

    expect(createShopifyDraftOrder).toHaveBeenCalledWith(expect.objectContaining({
      draftKey: 'opc_test:main',
      shippingMethod: 'express',
      shippingPrice: 9,
      taxPrice: 4,
      sourceUrl: '/a/s/checkout/opc_test/entry?cid=abc',
    }));
    expect(updateShopifyDraftOrder).not.toHaveBeenCalled();
    expect(updateCheckoutSession).toHaveBeenCalledWith(session.id, expect.objectContaining({
      customer: expect.objectContaining({ email: 'buyer@example.com' }),
      primaryDraftOrderId: 'gid://shopify/DraftOrder/10',
      primaryShippingMethod: 'express',
      subtotal: 40,
      shipping: 9,
      tax: 4,
      total: 53,
      checkoutStatus: 'ready_for_payment',
    }));
    expect(result.createdDraft).toBe(true);
    expect(result.submittedContact).toBe(true);
    expect(releaseCheckoutLock).toHaveBeenCalledWith(`${store.id}:checkout-prepare:${session.id}`, 'lock-token');
  });

  it('updates the existing Draft Order instead of creating another one', async () => {
    (getCheckoutSession as jest.Mock).mockResolvedValue({
      ...session,
      customer,
      checkoutStatus: 'ready_for_payment',
      primaryDraftOrderId: 'gid://shopify/DraftOrder/10',
    });

    const result = await prepareCheckoutSession(session.id, store, { customer, shippingMethod: 'standard' });

    expect(createShopifyDraftOrder).not.toHaveBeenCalled();
    expect(updateShopifyDraftOrder).toHaveBeenCalledWith(expect.objectContaining({
      draftOrderId: 'gid://shopify/DraftOrder/10',
      shippingMethod: 'standard',
      shippingPrice: 4,
    }));
    expect(result.createdDraft).toBe(false);
    expect(result.reviewed).toBe(false);
  });

  it('rejects unsupported shipping methods before touching Shopify', async () => {
    await expect(prepareCheckoutSession(session.id, store, {
      customer,
      shippingMethod: 'free' as 'standard',
    })).rejects.toThrow('Invalid shipping method');

    expect(createShopifyDraftOrder).not.toHaveBeenCalled();
    expect(updateShopifyDraftOrder).not.toHaveBeenCalled();
  });
});
