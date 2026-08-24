'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PaymentStep } from '@/components/checkout/PaymentStep';
import type { CheckoutSession } from '@/lib/checkout-sessions';
import styles from './OmniCheckout.module.css';

type Step = 'contact' | 'shipping_method' | 'payment_method';

interface ContactState {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  address1: string;
  address2: string;
  city: string;
  province: string;
  country: string;
  zip: string;
}

interface OmniCheckoutProps {
  initialSession: CheckoutSession;
  initialStep: string;
  cid: string;
}

const STEP_ORDER: Step[] = ['contact', 'shipping_method', 'payment_method'];

declare global {
  interface Window {
    fbq?: (...args: any[]) => void;
    ttq?: {
      track?: (event: string, payload?: Record<string, any>) => void;
    };
    paypal?: {
      Buttons: (config: Record<string, any>) => {
        render: (selector: string | HTMLElement) => Promise<void>;
      };
    };
  }
}

function asStep(step: string): Step {
  return STEP_ORDER.includes(step as Step) ? step as Step : 'contact';
}

function money(value: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(value);
}

function loadScript(id: string, src: string) {
  if (document.getElementById(id)) return;
  const script = document.createElement('script');
  script.id = id;
  script.async = true;
  script.src = src;
  document.head.appendChild(script);
}

function initBrowserPixels() {
  const metaPixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  const tikTokPixelId = process.env.NEXT_PUBLIC_TIKTOK_PIXEL_ID;

  if (metaPixelId && !window.fbq) {
    const fbq = function (...args: any[]) {
      (fbq as any).callMethod ? (fbq as any).callMethod(...args) : (fbq as any).queue.push(args);
    };
    (fbq as any).queue = [];
    (fbq as any).loaded = true;
    (fbq as any).version = '2.0';
    window.fbq = fbq;
    loadScript('meta-pixel', 'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', metaPixelId);
  }

  if (tikTokPixelId && !window.ttq) {
    const ttq: any = {
      _i: {},
      _t: {},
      _o: {},
      methods: ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie'],
    };
    ttq.setAndDefer = (target: any, method: string) => {
      target[method] = (...args: any[]) => {
        target.push([method, ...args]);
      };
    };
    ttq.instance = (id: string) => {
      const instance = ttq._i[id] || [];
      for (const method of ttq.methods) ttq.setAndDefer(instance, method);
      ttq._i[id] = instance;
      return instance;
    };
    ttq.load = (id: string) => {
      ttq._i[id] = [];
      ttq._i[id]._u = 'https://analytics.tiktok.com/i18n/pixel/events.js';
      ttq._t[id] = Date.now();
      ttq._o[id] = {};
      loadScript('tiktok-pixel', 'https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=' + id + '&lib=ttq');
    };
    for (const method of ttq.methods) ttq.setAndDefer(ttq, method);
    window.ttq = ttq;
    ttq.load(tikTokPixelId);
    ttq.page();
  }
}

export function OmniCheckout({ initialSession, initialStep, cid }: OmniCheckoutProps) {
  const [step, setStepState] = useState<Step>(asStep(initialStep));
  const [session] = useState(initialSession);
  const [shippingMethod, setShippingMethod] = useState<'standard' | 'express'>('standard');
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [paypalLoading, setPaypalLoading] = useState(false);
  const [error, setError] = useState('');
  const paypalRef = useRef<HTMLDivElement | null>(null);
  const paypalRenderedRef = useRef(false);
  const paypalPayloadRef = useRef<Record<string, any> | null>(null);
  const [contact, setContact] = useState<ContactState>({
    email: 'stevejianj@gmail.com',
    firstName: 'Jian',
    lastName: 'Steve',
    phone: '',
    address1: '4452 Corporation Ln',
    address2: '',
    city: 'Virginia Beach',
    province: 'Virginia',
    country: 'United States',
    zip: '23462',
  });

  const shipping = shippingMethod === 'express' ? 5.99 : session.shipping;
  const total = useMemo(
    () => Number((session.subtotal + shipping + session.tax).toFixed(2)),
    [session.subtotal, session.tax, shipping]
  );

  function setStep(nextStep: Step) {
    const url = new URL(window.location.href);
    if (nextStep === 'contact') {
      url.searchParams.delete('step');
    } else {
      url.searchParams.set('step', nextStep);
    }
    url.searchParams.set('cid', cid);
    window.history.pushState(null, '', url);
    setStepState(nextStep);
    setError('');
  }

  function updateContact(name: keyof ContactState, value: string) {
    setContact((current) => ({ ...current, [name]: value }));
  }

  function contactIsValid() {
    return contact.email && contact.firstName && contact.lastName && contact.address1 && contact.city && contact.province && contact.country && contact.zip;
  }

  function paypalPayload() {
    return {
      amount: total,
      currency: session.currency,
      checkoutSessionId: session.id,
      cid,
      sourceUrl: window.location.href,
      shippingMethod,
      utm: session.utm || {},
      lineItems: session.items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        title: item.title,
        price: item.price,
      })),
      shippingAddress: {
        firstName: contact.firstName,
        lastName: contact.lastName,
        address1: contact.address1,
        address2: contact.address2,
        city: contact.city,
        province: contact.province,
        zip: contact.zip,
        country: contact.country,
        email: contact.email,
        phone: contact.phone,
      },
    };
  }

  async function preparePayment() {
    if (!contactIsValid()) {
      setError('Please complete contact and shipping address.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/payment/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: total,
          currency: session.currency.toLowerCase(),
          email: contact.email,
          cartId: session.id,
          checkoutSessionId: session.id,
          cid,
          utm: session.utm || {},
          shippingMethod,
          sourceUrl: window.location.href,
          lineItems: session.items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
            title: item.title,
            price: item.price,
          })),
          shippingAddress: {
            firstName: contact.firstName,
            lastName: contact.lastName,
            address1: contact.address1,
            address2: contact.address2,
            city: contact.city,
            province: contact.province,
            zip: contact.zip,
            country: contact.country,
            email: contact.email,
            phone: contact.phone,
          },
        }),
      });
      if (!response.ok) throw new Error('Failed to prepare payment.');
      const json = await response.json();
      setClientSecret(json.clientSecret);
      setStep('payment_method');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment preparation failed.');
    } finally {
      setLoading(false);
    }
  }

  const activeIndex = STEP_ORDER.indexOf(step);
  const firstItem = session.items[0];

  useEffect(() => {
    initBrowserPixels();
  }, []);

  useEffect(() => {
    paypalPayloadRef.current = paypalPayload();
  });

  useEffect(() => {
    const paypalClientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
    if (!paypalClientId || !paypalRef.current || paypalRenderedRef.current) return;

    const renderButtons = () => {
      if (!window.paypal || !paypalRef.current || paypalRenderedRef.current) return;
      paypalRenderedRef.current = true;
      window.paypal.Buttons({
        style: {
          layout: 'horizontal',
          color: 'gold',
          shape: 'rect',
          label: 'paypal',
          height: 42,
        },
        onClick: () => {
          if (!contactIsValid()) {
            setError('Please complete contact and shipping address before using PayPal.');
            return false;
          }
          setError('');
          return true;
        },
        createOrder: async () => {
          setPaypalLoading(true);
          const response = await fetch('/api/payment/paypal/create-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(paypalPayloadRef.current),
          });
          if (!response.ok) throw new Error('Unable to create PayPal order.');
          const json = await response.json();
          return json.orderId;
        },
        onApprove: async (data: { orderID: string }) => {
          const response = await fetch('/api/payment/paypal/capture-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...paypalPayloadRef.current, orderId: data.orderID }),
          });
          if (!response.ok) throw new Error('Unable to capture PayPal payment.');
          window.location.href = `/a/s/checkout/${encodeURIComponent(session.id)}/upsell?cid=${encodeURIComponent(cid)}&payment_intent=${encodeURIComponent(`paypal:${data.orderID}`)}`;
        },
        onError: (err: Error) => {
          setPaypalLoading(false);
          setError(err.message || 'PayPal payment failed.');
        },
        onCancel: () => {
          setPaypalLoading(false);
        },
      }).render(paypalRef.current);
    };

    if (window.paypal) {
      renderButtons();
      return;
    }

    loadScript(
      'paypal-sdk',
      `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(paypalClientId)}&currency=${encodeURIComponent(session.currency.toUpperCase())}&intent=capture`
    );
    const timer = window.setInterval(renderButtons, 300);
    return () => window.clearInterval(timer);
  }, [cid, contact, session, shippingMethod, total]);

  useEffect(() => {
    const payload = {
      value: total,
      currency: session.currency,
      content_ids: session.items.map((item) => item.variantId),
      contents: session.items.map((item) => ({
        id: item.variantId,
        quantity: item.quantity,
        item_price: item.price,
      })),
      checkout_session_id: session.id,
      cid,
    };

    window.fbq?.('track', 'InitiateCheckout', payload, { eventID: `initiate:${session.id}` });
    window.ttq?.track?.('InitiateCheckout', payload);
  }, [cid, session.currency, session.id, session.items, total]);

  useEffect(() => {
    if (step !== 'payment_method') return;

    const payload = {
      value: total,
      currency: session.currency,
      checkout_session_id: session.id,
      cid,
    };

    window.fbq?.('track', 'AddPaymentInfo', payload, { eventID: `payment_info:${session.id}` });
    window.ttq?.track?.('AddPaymentInfo', payload);
  }, [cid, session.currency, session.id, step, total]);

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <section className={styles.checkoutColumn}>
          <nav className={styles.stepBar}>
            {STEP_ORDER.map((item, index) => (
              <span
                key={item}
                className={`${styles.stepPill} ${index <= activeIndex ? styles.stepPillActive : ''}`}
              >
                {item === 'contact' ? 'Contact' : item === 'shipping_method' ? 'Shipping' : 'Payment'}
              </span>
            ))}
          </nav>

          <div className={styles.trustHeader}>
            <div className={styles.safeTitle}><span>✓</span> Guaranteed SAFE Checkout</div>
            <div className={styles.logoRow}>
              <strong>McAfee SECURE</strong>
              <strong>VISA</strong>
              <strong>MasterCard</strong>
              <strong>AMERICAN EXPRESS</strong>
              <strong>PayPal</strong>
            </div>
          </div>

          {step === 'contact' && (
            <section className={styles.formPanel}>
              <div className={styles.urgency}>🔥 This product is very popular. Please complete your payment within 10 minutes; otherwise, the item could sell out!</div>
              <div className={styles.reserve}>Your order is reserved for 09:27</div>
              <div className={styles.paypalWrap}>
                <div ref={paypalRef} />
                {!process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID && (
                  <button className={styles.paypalButton} type="button" onClick={() => setError('PayPal is not configured yet.')}>
                    Pay with PayPal
                  </button>
                )}
                {paypalLoading && <span>Opening PayPal...</span>}
              </div>
              <div className={styles.divider}>OR</div>

              <h2>Contact information</h2>
              <FloatingInput label="Email (For order confirmation)" type="email" value={contact.email} onChange={(value) => updateContact('email', value)} />
              <label className={styles.checkbox}><input type="checkbox" defaultChecked /> Keep me up to date on news and exclusive offers</label>

              <h2>Shipping address</h2>
              <div className={styles.twoCols}>
                <FloatingInput label="First name" value={contact.firstName} onChange={(value) => updateContact('firstName', value)} />
                <FloatingInput label="Last name" value={contact.lastName} onChange={(value) => updateContact('lastName', value)} />
              </div>
              <FloatingInput label="Address" value={contact.address1} onChange={(value) => updateContact('address1', value)} />
              <FloatingInput label="Apartment, suite, etc. (optional)" value={contact.address2} onChange={(value) => updateContact('address2', value)} />
              <FloatingInput label="City" value={contact.city} onChange={(value) => updateContact('city', value)} />
              <div className={styles.threeCols}>
                <FloatingInput label="Country/Region" value={contact.country} onChange={(value) => updateContact('country', value)} />
                <FloatingInput label="State" value={contact.province} onChange={(value) => updateContact('province', value)} />
                <FloatingInput label="ZIP code" value={contact.zip} onChange={(value) => updateContact('zip', value)} />
              </div>
              <FloatingInput label="Phone (For shipping updates)" value={contact.phone} onChange={(value) => updateContact('phone', value)} />

              <div className={styles.actionRow}>
                <button className={styles.backButton} type="button">‹ Return to cart</button>
                <button className={styles.primaryButton} type="button" onClick={() => contactIsValid() ? setStep('shipping_method') : setError('Please complete contact and shipping address.')}>Continue to shipping</button>
              </div>
            </section>
          )}

          {step === 'shipping_method' && (
            <section className={styles.formPanel}>
              <ReviewBox contact={contact} shippingMethod={shippingMethod} showShipping={false} onEdit={setStep} />
              <h2>Shipping method</h2>
              <div className={styles.methodBox}>
                <ShippingOption id="standard" active={shippingMethod === 'standard'} price={session.shipping} label="Standard Shipping🌐(180 days Free refund)" onSelect={setShippingMethod} />
                <ShippingOption id="express" active={shippingMethod === 'express'} price={5.99} label="Express🌐(Worldwide shipping)" onSelect={setShippingMethod} />
              </div>
              <div className={styles.actionRow}>
                <button className={styles.backButton} type="button" onClick={() => setStep('contact')}>‹ Return to contact</button>
                <button className={styles.primaryButton} type="button" disabled={loading} onClick={preparePayment}>
                  {loading ? 'Preparing payment...' : 'Continue to payment'}
                </button>
              </div>
            </section>
          )}

          {step === 'payment_method' && (
            <section className={styles.formPanel}>
              <ReviewBox contact={contact} shippingMethod={shippingMethod} showShipping onEdit={setStep} />
              <h2>Payment method</h2>
              <p className={styles.muted}>All transactions are secure and encrypted.</p>
              {clientSecret ? (
                <PaymentStep
                  clientSecret={clientSecret}
                  returnUrl={`${window.location.origin}/a/s/checkout/${encodeURIComponent(session.id)}/upsell?cid=${encodeURIComponent(cid)}`}
                  onError={setError}
                />
              ) : (
                <button className={styles.primaryButton} type="button" disabled={loading} onClick={preparePayment}>
                  {loading ? 'Preparing payment...' : 'Load secure payment'}
                </button>
              )}
              <div className={styles.actionRow}>
                <button className={styles.backButton} type="button" onClick={() => setStep('shipping_method')}>‹ Return to shipping</button>
              </div>
            </section>
          )}

          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.footerBadges}>Verified by VISA · MasterCard SecureCode · Norton Secured · McAfee Secure · SSL Encrypted</div>
          <footer className={styles.footer}>Privacy policy<br />© 2026, Powered by Shopify</footer>
        </section>

        <aside className={styles.summaryColumn}>
          <div className={styles.productRow}>
            <div className={styles.thumbnail}>{firstItem?.image ? <img src={firstItem.image} alt="" /> : <span>1</span>}</div>
            <div>
              <strong>{firstItem?.title}</strong>
              <p>4-Pack — Family Favorite — Create together</p>
            </div>
            <strong>{money(session.subtotal, session.currency)}</strong>
          </div>
          <div className={styles.discountRow}>
            <input placeholder="Discount code" />
            <button type="button">Apply</button>
          </div>
          <SummaryLine label="Subtotal" value={money(session.subtotal, session.currency)} />
          <SummaryLine label="Shipping" value={money(shipping, session.currency)} />
          <div className={styles.totalRow}>
            <span>Total</span>
            <strong>{session.currency} {money(total, session.currency)}</strong>
          </div>
          <div className={styles.why}>Why choose us?</div>
          <TrustItem title="180-Day Money-Back Satisfaction Guarantee" text="If you are not satisfied with the products, we will give you a full refund—no questions asked." />
          <TrustItem title="More than 20,000 orders successfully shipped." text="We have gained as many satisfied customers as orders we have shipped." />
        </aside>
      </main>
    </div>
  );
}

function FloatingInput({ label, value, type = 'text', onChange }: { label: string; value: string; type?: string; onChange: (value: string) => void }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ReviewBox({ contact, shippingMethod, showShipping, onEdit }: { contact: ContactState; shippingMethod: string; showShipping: boolean; onEdit: (step: Step) => void }) {
  return (
    <div className={styles.reviewBox}>
      <div><span>Contact</span><strong>{contact.email}</strong><button type="button" onClick={() => onEdit('contact')}>Edit</button></div>
      <div><span>Ship to</span><strong>{contact.address1}, {contact.city}, {contact.province}, {contact.country}, {contact.zip}</strong><button type="button" onClick={() => onEdit('contact')}>Edit</button></div>
      {showShipping && <div><span>Shipping</span><strong>{shippingMethod === 'express' ? 'Express🌐(Worldwide shipping)' : 'Standard Shipping🌐(180 days Free refund)'}</strong><button type="button" onClick={() => onEdit('shipping_method')}>Edit</button></div>}
    </div>
  );
}

function ShippingOption({ id, active, price, label, onSelect }: { id: 'standard' | 'express'; active: boolean; price: number; label: string; onSelect: (id: 'standard' | 'express') => void }) {
  return (
    <button className={styles.shippingOption} type="button" onClick={() => onSelect(id)}>
      <span className={active ? styles.radioActive : styles.radio} />
      <span>{label}</span>
      <strong>{money(price)}</strong>
    </button>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return <div className={styles.summaryLine}><span>{label}</span><strong>{value}</strong></div>;
}

function TrustItem({ title, text }: { title: string; text: string }) {
  return <div className={styles.trustItem}><span>$</span><p><strong>{title}</strong>{text}</p></div>;
}
