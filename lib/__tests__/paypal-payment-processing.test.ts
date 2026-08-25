jest.mock('../checkout-sessions', () => ({
  getCheckoutSession: jest.fn(),
  updateCheckoutSession: jest.fn(),
}));
jest.mock('../funnel-runtime', () => ({
  nextStepAfterDecision: jest.fn(),
  sessionFunnelVersion: jest.fn(),
}));
jest.mock('../order-finalization', () => ({
  finalizeCheckoutSession: jest.fn(),
}));
jest.mock('../checkout-events', () => ({
  recordCheckoutEvent: jest.fn(),
}));

import { getCheckoutSession, updateCheckoutSession } from '../checkout-sessions';
import { nextStepAfterDecision } from '../funnel-runtime';
import { finalizeCheckoutSession } from '../order-finalization';
import { recordCheckoutEvent } from '../checkout-events';
import { processPayPalUpsellSucceeded } from '../paypal-payment-processing';
import type { CheckoutSession } from '../checkout-sessions';
import type { StoreConfig } from '../store-configs';

const store = { id: 'store.myshopify.com', currency: 'USD', taxRate: 0, standardShipping: 4, expressShipping: 8 } as StoreConfig;
const addOn = {
  id: 'add-on',
  variantId: 'gid://shopify/ProductVariant/2',
  title: 'Add-on',
  quantity: 1,
  price: 12,
};
const session = {
  id: 'session-1',
  storeId: store.id,
  primaryPaymentStatus: 'paid',
  primaryPaymentId: 'paypal:main-capture',
  currentStepId: 'offer',
  items: [],
  upsellStates: { offer: { offerId: 'offer', stepId: 'offer', item: addOn, paymentStatus: 'pending' } },
  currency: 'USD',
} as unknown as CheckoutSession;

describe('PayPal funnel progression', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCheckoutSession as jest.Mock).mockResolvedValue(session);
    (updateCheckoutSession as jest.Mock).mockImplementation(async (_id: string, patch: Partial<CheckoutSession>) => ({ ...session, ...patch }));
    (nextStepAfterDecision as jest.Mock).mockReturnValue({ id: 'thanks', type: 'thank_you' });
    (finalizeCheckoutSession as jest.Mock).mockResolvedValue({ id: 'order-1', order_number: 1001, session: { ...session, primaryOrderNumber: 1001 } });
    (recordCheckoutEvent as jest.Mock).mockResolvedValue({});
  });

  it('records the add-on amount and finalizes after the last accepted step', async () => {
    const result = await processPayPalUpsellSucceeded(session.id, store, 'offer', 'paypal:add-on-capture');

    expect(recordCheckoutEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'payment_succeeded',
      purchaseKind: 'upsell',
      value: 12,
      currency: 'USD',
    }));
    expect(finalizeCheckoutSession).toHaveBeenCalledWith(session.id, store, { force: true });
    expect(result.primaryOrderNumber).toBe(1001);
  });
});
