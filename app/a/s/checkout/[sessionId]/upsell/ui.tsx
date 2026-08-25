'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { loadStripe } from '@stripe/stripe-js';
import type { CheckoutLineItem, CheckoutSession } from '@/lib/checkout-sessions';
import type { FunnelStep } from '@/lib/funnel-configs';
import type { PublicStoreConfig } from '@/lib/store-configs';
import styles from './Upsell.module.css';

declare global {
  interface Window {
    paypal?: {
      Buttons: (config: Record<string, any>) => { render: (target: string | HTMLElement) => Promise<void> };
    };
  }
}

interface UpsellCheckoutProps {
  session: CheckoutSession;
  storeConfig: PublicStoreConfig;
  step: FunnelStep;
  offerItem: CheckoutLineItem;
  cid: string;
  parentPaymentIntentId: string;
  checkoutToken: string;
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
}

function nextUrl(sessionId: string, cid: string, parentPaymentIntentId: string, checkoutToken: string) {
  const params = new URLSearchParams({ cid, parent_payment_intent: parentPaymentIntentId, checkout_token: checkoutToken });
  return `/a/s/checkout/${encodeURIComponent(sessionId)}/upsell?${params.toString()}`;
}

function loadPayPalScript(clientId: string, currency: string) {
  const id = 'omni-paypal-upsell-sdk';
  if (document.getElementById(id)) return;
  const script = document.createElement('script');
  script.id = id;
  script.async = true;
  script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${encodeURIComponent(currency)}&intent=capture`;
  document.head.appendChild(script);
}

function navigate(path: string) {
  window.location.assign(new URL(path, window.location.origin).toString());
}

export function UpsellCheckout({ session, storeConfig, step, offerItem, cid, parentPaymentIntentId, checkoutToken }: UpsellCheckoutProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const paypalRef = useRef<HTMLDivElement | null>(null);
  const paypalRenderedRef = useRef(false);
  const price = offerItem.price * offerItem.quantity;
  const acceptLabel = step.offer?.acceptLabel || `Yes, add it for ${money(price, session.currency)}`;
  const declineLabel = step.offer?.declineLabel || 'No thanks, continue to my order';
  const returnUrl = useMemo(() => nextUrl(session.id, cid, parentPaymentIntentId, checkoutToken), [cid, checkoutToken, parentPaymentIntentId, session.id]);

  useEffect(() => {
    if (!parentPaymentIntentId.startsWith('paypal:') || !storeConfig.paypalClientId || !paypalRef.current || paypalRenderedRef.current) return;
    const render = () => {
      if (!window.paypal || !paypalRef.current || paypalRenderedRef.current) return;
      paypalRenderedRef.current = true;
      window.paypal.Buttons({
        style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'paypal', height: 48 },
        createOrder: async () => {
          const response = await fetch(`/a/s/api/payment/paypal/create-order?checkout_token=${encodeURIComponent(checkoutToken)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checkoutSessionId: session.id, purchaseKind: 'upsell', stepId: step.id, parentPaymentIntentId }),
          });
          const json = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(json.error || 'Unable to create PayPal add-on order.');
          return json.orderId;
        },
        onApprove: async (data: { orderID: string }) => {
          setLoading(true);
          const response = await fetch(`/a/s/api/payment/paypal/capture-order?checkout_token=${encodeURIComponent(checkoutToken)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checkoutSessionId: session.id, purchaseKind: 'upsell', stepId: step.id, orderId: data.orderID }),
          });
          const json = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(json.error || 'Unable to capture PayPal add-on payment.');
          navigate(returnUrl);
        },
        onError: (paypalError: Error) => {
          setLoading(false);
          setError(paypalError.message || 'PayPal payment failed.');
        },
      }).render(paypalRef.current);
    };
    if (window.paypal) render();
    else {
      loadPayPalScript(storeConfig.paypalClientId, session.currency.toUpperCase());
      const timer = window.setInterval(render, 250);
      return () => window.clearInterval(timer);
    }
  }, [checkoutToken, parentPaymentIntentId, session.currency, session.id, step.id, storeConfig.paypalClientId, returnUrl]);

  async function acceptOffer() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/a/s/api/payment/create-intent?checkout_token=${encodeURIComponent(checkoutToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checkoutSessionId: session.id,
          purchaseKind: 'upsell',
          stepId: step.id,
          cid,
          sourceUrl: window.location.href,
          shippingMethod: 'ships-with-original-order',
          parentPaymentIntentId,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok && !json.requiresAction) throw new Error(json.error || 'Unable to load this offer.');
      if (json.status === 'succeeded') {
        navigate(returnUrl);
        return;
      }
      if (!json.clientSecret) throw new Error('Stripe did not return an authentication session.');
      const stripe = await loadStripe(storeConfig.stripePublishableKey || '');
      if (!stripe) throw new Error('Secure payment is unavailable.');
      const result = await stripe.confirmCardPayment(json.clientSecret, { return_url: `${window.location.origin}${returnUrl}` } as any);
      if (result.error) throw new Error(result.error.message || 'Offer payment failed.');
      navigate(returnUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Offer payment failed.');
      setLoading(false);
    }
  }

  async function declineOffer() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/a/s/api/checkout/funnel/decision?checkout_token=${encodeURIComponent(checkoutToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkoutSessionId: session.id, stepId: step.id, decision: 'declined' }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Unable to continue.');
      if (json.completed) {
        navigate(`/a/s/checkout/${encodeURIComponent(session.id)}/success?checkout_session_id=${encodeURIComponent(session.id)}&payment_intent=${encodeURIComponent(parentPaymentIntentId)}&checkout_token=${encodeURIComponent(checkoutToken)}`);
      } else {
        navigate(returnUrl);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to continue.');
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.offer} aria-live="polite">
        <div className={styles.kicker}>{step.type === 'downsell' ? 'Special follow-up offer' : 'Limited one-time offer'}</div>
        <h1>{step.settings?.headline || step.name}</h1>
        <p className={styles.copy}>{step.settings?.body || 'Add this item now and ship it together with your original order.'}</p>

        <div className={styles.product}>
          <div className={styles.image}>
            {offerItem.image ? <Image src={offerItem.image} alt="" width={76} height={76} unoptimized /> : <span>ADD</span>}
          </div>
          <div>
            <strong>{step.offer?.title || offerItem.title}</strong>
            <p>{step.offer?.description || 'Extra value for your next order.'}</p>
          </div>
          <strong className={styles.price}>{money(price, session.currency)}</strong>
        </div>

        {parentPaymentIntentId.startsWith('paypal:') ? (
          <div className={styles.actions}>
            {storeConfig.paypalClientId ? <div ref={paypalRef} /> : <p className={styles.error}>PayPal add-on payment is not configured.</p>}
            <button type="button" className={styles.decline} disabled={loading} onClick={declineOffer}>{declineLabel}</button>
          </div>
        ) : (
          <div className={styles.actions}>
            <button type="button" className={styles.accept} disabled={loading} onClick={acceptOffer}>
              {loading ? 'Processing securely...' : acceptLabel}
            </button>
            <button type="button" className={styles.decline} disabled={loading} onClick={declineOffer}>{declineLabel}</button>
          </div>
        )}
        <p className={styles.disclosure}>Your original payment method may be charged for this add-on. No card details are entered on this page.</p>
        {error && <div className={styles.error} role="alert">{error}</div>}
      </section>
    </main>
  );
}

export function UpsellWaiting({ sessionId, checkoutToken }: { sessionId: string; checkoutToken: string }) {
  return (
    <main className={styles.page}>
      <section className={styles.offer}>
        <div className={styles.kicker}>Payment confirmation</div>
        <h1>We are confirming your payment</h1>
        <p className={styles.copy}>This page will update when the secure payment provider confirms the transaction.</p>
        <a className={styles.accept} href={`/a/s/checkout/${encodeURIComponent(sessionId)}/upsell?checkout_token=${encodeURIComponent(checkoutToken)}`}>Check status</a>
      </section>
    </main>
  );
}
