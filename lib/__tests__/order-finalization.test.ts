import { bundledLineItems } from '../order-finalization';
import type { CheckoutSession } from '../checkout-sessions';

const mainItem = {
  id: 'main',
  variantId: 'gid://shopify/ProductVariant/1',
  title: 'Main product',
  quantity: 1,
  price: 30,
};

const addOnItem = {
  id: 'add-on',
  variantId: 'gid://shopify/ProductVariant/2',
  title: 'Add-on product',
  quantity: 2,
  price: 5,
};

describe('order finalization line-item bundle', () => {
  it('includes every paid funnel offer exactly once', () => {
    const session = {
      items: [mainItem],
      upsellStates: {
        first: { offerId: 'first', stepId: 'first', item: addOnItem, paymentStatus: 'paid' },
        declined: { offerId: 'declined', stepId: 'declined', item: mainItem, paymentStatus: 'failed' },
      },
    } as unknown as CheckoutSession;

    expect(bundledLineItems(session)).toEqual([mainItem, addOnItem]);
  });

  it('supports legacy sessions that only stored one paid add-on', () => {
    const session = {
      items: [mainItem],
      upsellPaymentStatus: 'paid',
      upsellItem: addOnItem,
      upsellStates: {},
    } as unknown as CheckoutSession;

    expect(bundledLineItems(session)).toEqual([mainItem, addOnItem]);
  });
});
