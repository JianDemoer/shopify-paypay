jest.mock('../checkout-sessions', () => ({
  getCheckoutSession: jest.fn(),
  updateCheckoutSession: jest.fn(),
}));

jest.mock('../checkout-events', () => ({ recordCheckoutEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../checkout-finalization-scheduler', () => ({
  checkoutFinalizationDeadline: jest.fn(),
  scheduleCheckoutFinalizationSafely: jest.fn(),
}));

import { recordFunnelDecision } from '../funnel-progress';
import { updateCheckoutSession } from '../checkout-sessions';
import { scheduleCheckoutFinalizationSafely } from '../checkout-finalization-scheduler';
import type { CheckoutSession } from '../checkout-sessions';
import type { StoreConfig } from '../store-configs';

const store = {
  id: 'test.myshopify.com',
  shopDomain: 'test.myshopify.com',
  upsellVariantId: 'gid://shopify/ProductVariant/2',
  funnels: [{
    id: 'funnel-1',
    name: 'Funnel',
    enabled: true,
    publishedVersionId: 'v1',
    versions: [{
      id: 'v1',
      version: 1,
      status: 'published',
      entryStepId: 'checkout',
      steps: [
        { id: 'checkout', type: 'checkout', name: 'Checkout', enabled: true, triggerRules: [], acceptNextStepId: 'offer' },
        { id: 'offer', type: 'upsell', name: 'Offer', enabled: true, triggerRules: [], acceptNextStepId: 'thanks', declineNextStepId: 'thanks', offer: { variantId: 'gid://shopify/ProductVariant/2', quantity: 1 } },
        { id: 'thanks', type: 'thank_you', name: 'Thanks', enabled: true, triggerRules: [] },
      ],
    }],
  }],
} as unknown as StoreConfig;

const session = {
  id: 'opc_preview',
  storeId: store.id,
  shopDomain: store.shopDomain,
  cid: 'cid-preview',
  currency: 'USD',
  items: [{ id: 'line-1', variantId: 'gid://shopify/ProductVariant/1', title: 'Pen', quantity: 1, price: 20 }],
  subtotal: 20,
  shipping: 4,
  tax: 0,
  total: 24,
  funnelId: 'funnel-1',
  funnelVersionId: 'v1',
  currentStepId: 'checkout',
  completedStepIds: [],
  createdAt: '2026-08-26T00:00:00.000Z',
  expiresAt: '2026-09-02T00:00:00.000Z',
} as CheckoutSession;

describe('funnel preview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (updateCheckoutSession as jest.Mock).mockImplementation(async (_id, patch) => ({ ...session, ...patch }));
  });

  it('records a preview decision from checkout without scheduling order finalization', async () => {
    const updated = await recordFunnelDecision(store, session, 'offer', 'accepted', { preview: true });

    expect(updateCheckoutSession).toHaveBeenCalledWith(session.id, expect.objectContaining({
      currentStepId: 'thanks',
      finalizationStatus: undefined,
      finalizeAfter: undefined,
      upsellStates: expect.objectContaining({ offer: expect.objectContaining({ decision: 'accepted' }) }),
    }));
    expect(scheduleCheckoutFinalizationSafely).not.toHaveBeenCalled();
    expect(updated.currentStepId).toBe('thanks');
  });

  it('does not allow an unrelated funnel step to be recorded during preview', async () => {
    await expect(recordFunnelDecision(store, session, 'unknown-step', 'declined', { preview: true }))
      .rejects.toThrow('Funnel step is no longer active');
  });
});
