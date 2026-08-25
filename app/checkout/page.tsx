'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useCart } from '@/contexts/CartContext';
import styles from './CheckoutPage.module.css';

function trackingParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    source: params.get('utm_source') || '',
    campaign: params.get('utm_campaign') || '',
    medium: params.get('utm_medium') || '',
    content: params.get('utm_content') || '',
    term: params.get('utm_term') || '',
  };
}

function clientId() {
  const key = 'opc_cid';
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const value = window.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  window.sessionStorage.setItem(key, value);
  return value;
}

export default function CheckoutPage() {
  const { items, isHydrated } = useCart();
  const started = useRef(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isHydrated || started.current || items.length === 0) return;
    started.current = true;

    const start = async () => {
      try {
        const response = await fetch('/api/checkout/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            shopDomain: process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN || undefined,
            cid: clientId(),
            utm: trackingParams(),
            items: items.map((item) => ({
              variantId: item.variantId,
              quantity: item.quantity,
            })),
          }),
        });
        const json = await response.json();
        if (!response.ok || !json.redirectUrl) {
          throw new Error(json.error || 'Unable to start checkout');
        }
        window.location.assign(json.redirectUrl);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Unable to start checkout');
        started.current = false;
      }
    };

    void start();
  }, [isHydrated, items]);

  if (!isHydrated) {
    return (
      <main className={styles.emptyCheckoutScreen}>
        <section className={styles.emptyCheckoutContent}>
          <h1 className={styles.emptyCheckoutTitle}>Preparing checkout</h1>
          <p className={styles.emptyCheckoutMessage}>Loading your cart...</p>
        </section>
      </main>
    );
  }

  if (items.length === 0) {
    return (
      <main className={styles.emptyCheckoutScreen}>
        <section className={styles.emptyCheckoutContent}>
          <h1 className={styles.emptyCheckoutTitle}>Your Cart is Empty</h1>
          <p className={styles.emptyCheckoutMessage}>Please add items before checking out.</p>
          <Link href="/cart" className={styles.emptyCheckoutLink}>Back to Cart</Link>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.emptyCheckoutScreen}>
      <section className={styles.emptyCheckoutContent}>
        <h1 className={styles.emptyCheckoutTitle}>{error ? 'Checkout could not start' : 'Preparing checkout'}</h1>
        <p className={styles.emptyCheckoutMessage}>{error || 'Securing your order and loading payment options...'}</p>
        {error && (
          <button type="button" className={styles.emptyCheckoutLink} onClick={() => { setError(''); started.current = false; }}>
            Try again
          </button>
        )}
      </section>
    </main>
  );
}
