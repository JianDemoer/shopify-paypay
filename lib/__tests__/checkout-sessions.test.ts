import { createCheckoutSession } from '../checkout-sessions';

const validItem = {
  id: 'variant-1',
  variantId: 'gid://shopify/ProductVariant/1',
  title: 'Test product',
  quantity: 1,
  price: 10,
};

describe('checkout session validation', () => {
  it('rejects an empty checkout', async () => {
    await expect(createCheckoutSession({ items: [] })).rejects.toThrow('between 1 and 50 items');
  });

  it('rejects invalid quantity in a resolved item', async () => {
    await expect(createCheckoutSession({}, [{ ...validItem, quantity: 0 }])).rejects.toThrow('Invalid checkout line item');
  });

  it('rejects invalid price and totals', async () => {
    await expect(createCheckoutSession({}, [{ ...validItem, price: 100001 }])).rejects.toThrow('Invalid checkout line item price');
    await expect(createCheckoutSession({ shipping: -1 }, [validItem])).rejects.toThrow('Invalid checkout totals');
  });
});
