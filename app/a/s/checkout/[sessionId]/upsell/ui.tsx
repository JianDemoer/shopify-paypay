'use client';

import { useMemo, useState } from 'react';
import { PaymentStep } from '@/components/checkout/PaymentStep';
import type { CheckoutSession } from '@/lib/checkout-sessions';
import styles from './Upsell.module.css';

interface UpsellCheckoutProps {
  session: CheckoutSession;
  cid: string;
  parentPaymentIntentId: string;
}

const UPSELL_PRICE = 19.97;

export function UpsellCheckout({ session, cid, parentPaymentIntentId }: UpsellCheckoutProps) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const originalItem = session.items[0];
  const returnUrl = useMemo(() => {
    const params = new URLSearchParams({
      checkout_session_id: session.id,
      cid,
      upsell: 'accepted',
      parent_payment_intent: parentPaymentIntentId,
    });
    return `${window.location.origin}/checkout/success?${params.toString()}`;
  }, [cid, parentPaymentIntentId, session.id]);

  const declineUrl = useMemo(() => {
    const params = new URLSearchParams({
      checkout_session_id: session.id,
      cid,
      upsell: 'declined',
      payment_intent: parentPaymentIntentId,
    });
    return `/checkout/success?${params.toString()}`;
  }, [cid, parentPaymentIntentId, session.id]);

  async function acceptOffer() {
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/payment/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: UPSELL_PRICE,
          currency: session.currency.toLowerCase(),
          cartId: `${session.id}:upsell`,
          checkoutSessionId: session.id,
          cid,
          sourceUrl: window.location.href,
          shippingMethod: 'ships-with-original-order',
          utm: session.utm || {},
          parentPaymentIntentId,
          orderType: 'post_purchase_upsell',
          lineItems: [
            {
              productId: process.env.NEXT_PUBLIC_UPSELL_PRODUCT_ID || originalItem?.productId,
              variantId: process.env.NEXT_PUBLIC_UPSELL_VARIANT_ID || originalItem?.variantId,
              quantity: 1,
              title: 'Post-Purchase Add-On Pack',
              price: UPSELL_PRICE,
            },
          ],
          shippingAddress: {
            firstName: 'Post',
            lastName: 'Purchase',
            address1: 'Ships with original order',
            city: 'Original order',
            province: 'Original order',
            zip: '00000',
            country: 'United States',
          },
        }),
      });

      if (!response.ok) throw new Error('Unable to load this offer.');
      const json = await response.json();
      setClientSecret(json.clientSecret);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Offer payment failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.offer}>
        <div className={styles.kicker}>Limited one-time offer</div>
        <h1>Add a second creative pack for less</h1>
        <p className={styles.copy}>
          Your order is confirmed. Add this pack now and it ships together with your original order.
        </p>

        <div className={styles.product}>
          <div className={styles.image}>
            {originalItem?.image ? <img src={originalItem.image} alt="" /> : <span>ADD</span>}
          </div>
          <div>
            <strong>Post-Purchase Add-On Pack</strong>
            <p>Extra supplies for gifts, family use, or backup inventory.</p>
          </div>
          <strong className={styles.price}>${UPSELL_PRICE.toFixed(2)}</strong>
        </div>

        {clientSecret ? (
          <PaymentStep clientSecret={clientSecret} returnUrl={returnUrl} onError={setError} />
        ) : (
          <div className={styles.actions}>
            <button type="button" className={styles.accept} disabled={loading} onClick={acceptOffer}>
              {loading ? 'Loading secure payment...' : `Yes, add it for $${UPSELL_PRICE.toFixed(2)}`}
            </button>
            <a className={styles.decline} href={declineUrl}>No thanks, continue to my order</a>
          </div>
        )}

        {error && <div className={styles.error}>{error}</div>}
      </section>
    </main>
  );
}
