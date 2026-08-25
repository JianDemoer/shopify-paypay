import { calculateTotals } from '../checkout-pricing';
import type { CheckoutLineItem } from '../checkout-sessions';
import type { StoreConfig } from '../store-configs';

const config = {
  standardShipping: 3.99,
  expressShipping: 8.5,
  taxRate: 0.08,
  currency: 'USD',
} as StoreConfig;

const items: CheckoutLineItem[] = [{
  id: 'variant-1',
  variantId: 'gid://shopify/ProductVariant/1',
  title: 'Test product',
  quantity: 2,
  price: 10,
}];

describe('checkout pricing', () => {
  it('calculates configured standard shipping and tax on the server', () => {
    expect(calculateTotals(items, config, 'standard', 'main')).toEqual({
      subtotal: 20,
      shipping: 3.99,
      tax: 1.6,
      total: 25.59,
    });
  });

  it('uses configured express shipping and no extra shipping for an upsell', () => {
    expect(calculateTotals(items, config, 'express', 'main').shipping).toBe(8.5);
    expect(calculateTotals(items, config, 'express', 'upsell').shipping).toBe(0);
    expect(calculateTotals(items, config, 'ships-with-original-order', 'main').shipping).toBe(0);
  });
});
