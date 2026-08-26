import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OmniCheckout } from './ui';
import type { CheckoutSession } from '@/lib/checkout-sessions';
import type { PublicStoreConfig } from '@/lib/store-configs';

const session = {
  id: 'opc_ui_test',
  storeId: 'test.myshopify.com',
  shopDomain: 'test.myshopify.com',
  cid: 'cid-test',
  currency: 'USD',
  items: [{ id: 'line-1', variantId: 'gid://shopify/ProductVariant/1', title: 'Pen', quantity: 1, price: 20 }],
  subtotal: 20,
  shipping: 4,
  tax: 0,
  total: 24,
  checkoutStatus: 'open',
  createdAt: '2026-08-26T00:00:00.000Z',
  expiresAt: '2026-09-02T00:00:00.000Z',
} as CheckoutSession;

const store = {
  id: 'test.myshopify.com',
  name: 'Test Store',
  shopDomain: 'test.myshopify.com',
  currency: 'USD',
  orderMode: 'draft_order',
  stripePublishableKey: '',
  paypalEnv: 'sandbox',
  standardShipping: 4,
  expressShipping: 9,
  taxRate: 0,
} as PublicStoreConfig;

function preparedSession() {
  return {
    ...session,
    customer: {
      email: 'buyer@example.com', firstName: 'Test', lastName: 'Buyer', address1: '100 Main Street',
      city: 'Austin', province: 'TX', country: 'US', zip: '78701', phone: '',
    },
    primaryShippingMethod: 'standard' as const,
    primaryDraftOrderId: 'gid://shopify/DraftOrder/10',
    checkoutStatus: 'ready_for_payment' as const,
  };
}

describe('OmniCheckout non-payment flow', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ session: preparedSession() }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('saves contact and shipping through prepare without initializing payment', async () => {
    const user = userEvent.setup();
    render(<OmniCheckout initialSession={session} storeConfig={store} initialStep="contact" cid={session.cid} checkoutToken="token" />);

    await user.type(screen.getByLabelText('Email (for order updates)'), 'buyer@example.com');
    await user.type(screen.getByLabelText('First name'), 'Test');
    await user.type(screen.getByLabelText('Last name'), 'Buyer');
    await user.type(screen.getByLabelText('Address'), '100 Main Street');
    await user.type(screen.getByLabelText('City'), 'Austin');
    await user.clear(screen.getByLabelText('Country/Region'));
    await user.type(screen.getByLabelText('Country/Region'), 'US');
    await user.type(screen.getByLabelText('ZIP code'), '78701');
    await user.click(screen.getByRole('button', { name: 'Continue to shipping' }));

    expect(global.fetch).toHaveBeenCalledWith(
      '/a/s/api/checkout/prepare?checkout_token=token',
      expect.objectContaining({ method: 'POST' })
    );
    const firstPayload = JSON.parse(String((global.fetch as jest.Mock).mock.calls[0][1].body));
    expect(firstPayload).toMatchObject({ checkoutSessionId: session.id, shippingMethod: 'standard' });
    expect(String((global.fetch as jest.Mock).mock.calls[0][0])).not.toContain('/api/payment/');

    await user.click(screen.getByRole('button', { name: 'Save and review order' }));
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(String((global.fetch as jest.Mock).mock.calls[1][0])).toContain('/a/s/api/checkout/prepare');
    expect(screen.getByText('Draft Order saved. You can safely test the post-purchase funnel below.')).toBeInTheDocument();
    expect(screen.getByText(/No payment details are collected on this page/)).toBeInTheDocument();
  });
});
