import { summarizeCheckoutEvents, type CheckoutEvent } from '../checkout-events';

const event = (type: CheckoutEvent['type'], sessionId: string, value?: number, purchaseKind?: CheckoutEvent['purchaseKind']): CheckoutEvent => ({
  id: `${type}-${sessionId}-${purchaseKind || 'none'}`,
  type,
  storeId: 'store.myshopify.com',
  sessionId,
  occurredAt: '2026-08-25T00:00:00.000Z',
  value,
  purchaseKind,
});

describe('checkout event reports', () => {
  it('prefers final bundled revenue over intermediate payment events', () => {
    const summary = summarizeCheckoutEvents([
      event('checkout_started', 'one'),
      event('payment_succeeded', 'one', 30, 'main'),
      event('payment_succeeded', 'one', 10, 'upsell'),
      event('order_finalized', 'one', 40),
      event('checkout_started', 'two'),
      event('payment_succeeded', 'two', 25, 'main'),
    ]);
    expect(summary.orders).toBe(1);
    expect(summary.revenue).toBe(65);
    expect(summary.upsellRevenue).toBe(10);
    expect(summary.upsellOrders).toBe(1);
  });
});
