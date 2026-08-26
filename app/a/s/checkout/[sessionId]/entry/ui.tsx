'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { PaymentStep } from '@/components/checkout/PaymentStep';
import type { CheckoutSession } from '@/lib/checkout-sessions';
import type { PublicStoreConfig } from '@/lib/store-configs';
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
  storeConfig: PublicStoreConfig;
  initialStep: string;
  cid: string;
  checkoutToken: string;
}

const STEP_ORDER: Step[] = ['contact', 'shipping_method', 'payment_method'];

declare global {
  interface Window {
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

function navigate(path: string) {
  window.location.assign(new URL(path, window.location.origin).toString());
}

export function OmniCheckout({ initialSession, storeConfig, initialStep, cid, checkoutToken }: OmniCheckoutProps) {
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
  const contactValidRef = useRef(false);
  const [contact, setContact] = useState<ContactState>({
    email: '',
    firstName: '',
    lastName: '',
    phone: '',
    address1: '',
    address2: '',
    city: '',
    province: '',
    country: 'United States',
    zip: '',
  });
  const isOnePage = session.checkoutMode === 'one_page';

  const shipping = shippingMethod === 'express' ? storeConfig.expressShipping : storeConfig.standardShipping;
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
    return contact.email && contact.firstName && contact.lastName && contact.address1 && contact.city && contact.country && contact.zip;
  }

  function paypalPayload() {
    return {
      checkoutSessionId: session.id,
      cid,
      shippingMethod,
      shippingAddress: contact,
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
      const response = await fetch(`/a/s/api/payment/create-intent?checkout_token=${encodeURIComponent(checkoutToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checkoutSessionId: session.id,
          purchaseKind: 'main',
          shippingMethod,
          sourceUrl: window.location.href,
          shippingAddress: contact,
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
  useEffect(() => {
    paypalPayloadRef.current = paypalPayload();
    contactValidRef.current = Boolean(contactIsValid());
  });

  useEffect(() => {
    const paypalClientId = storeConfig.paypalClientId;
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
          if (!contactValidRef.current) {
            setError('Please complete contact and shipping address before using PayPal.');
            return false;
          }
          setError('');
          return true;
        },
        createOrder: async () => {
          setPaypalLoading(true);
          const response = await fetch(`/a/s/api/payment/paypal/create-order?checkout_token=${encodeURIComponent(checkoutToken)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(paypalPayloadRef.current),
          });
          if (!response.ok) throw new Error('Unable to create PayPal order.');
          const json = await response.json();
          return json.orderId;
        },
        onApprove: async (data: { orderID: string }) => {
          const response = await fetch(`/a/s/api/payment/paypal/capture-order?checkout_token=${encodeURIComponent(checkoutToken)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...paypalPayloadRef.current, orderId: data.orderID }),
          });
          if (!response.ok) throw new Error('Unable to capture PayPal payment.');
          const capture = await response.json();
          navigate(`/a/s/checkout/${encodeURIComponent(session.id)}/upsell?cid=${encodeURIComponent(cid)}&parent_payment_intent=${encodeURIComponent(capture.paymentId)}&checkout_token=${encodeURIComponent(checkoutToken)}`);
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
  }, [checkoutToken, cid, session, storeConfig.paypalClientId]);

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
            <div className={styles.safeTitle}><span>✓</span> Secure Checkout</div>
            <div className={styles.logoRow}>
              <strong>VISA</strong>
              <strong>MasterCard</strong>
              <strong>AMERICAN EXPRESS</strong>
              <strong>PayPal</strong>
            </div>
          </div>

          {(isOnePage || step === 'contact') && (
            <section className={styles.formPanel}>
              <div className={styles.paypalWrap}>
                <div ref={paypalRef} />
                {!storeConfig.paypalClientId && (
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
                <button className={styles.backButton} type="button" onClick={() => navigate('/cart')}>‹ Return to cart</button>
                <button className={styles.primaryButton} type="button" onClick={() => contactIsValid() ? setStep('shipping_method') : setError('Please complete contact and shipping address.')}>Continue to shipping</button>
              </div>
            </section>
          )}

          {(isOnePage || step === 'shipping_method') && (
            <section className={styles.formPanel}>
              <ReviewBox contact={contact} shippingMethod={shippingMethod} showShipping={false} onEdit={setStep} />
              <h2>Shipping method</h2>
              <div className={styles.methodBox}>
                <ShippingOption id="standard" active={shippingMethod === 'standard'} price={storeConfig.standardShipping} currency={session.currency} label="Standard Shipping (180-day refund policy)" onSelect={setShippingMethod} />
                <ShippingOption id="express" active={shippingMethod === 'express'} price={storeConfig.expressShipping} currency={session.currency} label="Express (worldwide shipping)" onSelect={setShippingMethod} />
              </div>
              <div className={styles.actionRow}>
                <button className={styles.backButton} type="button" onClick={() => setStep('contact')}>‹ Return to contact</button>
                <button className={styles.primaryButton} type="button" disabled={loading} onClick={preparePayment}>
                  {loading ? 'Preparing payment...' : 'Continue to payment'}
                </button>
              </div>
            </section>
          )}

          {(isOnePage || step === 'payment_method') && (
            <section className={styles.formPanel}>
              <ReviewBox contact={contact} shippingMethod={shippingMethod} showShipping onEdit={setStep} />
              <h2>Payment method</h2>
              <p className={styles.muted}>All transactions are secure and encrypted.</p>
              {clientSecret ? (
                <PaymentStep
                  clientSecret={clientSecret}
                  publishableKey={storeConfig.stripePublishableKey}
                  returnUrl={`${window.location.origin}/a/s/checkout/${encodeURIComponent(session.id)}/upsell?cid=${encodeURIComponent(cid)}&checkout_token=${encodeURIComponent(checkoutToken)}`}
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
          <div className={styles.footerBadges}>Encrypted payment processing · Order confirmation by email</div>
          <footer className={styles.footer}>Privacy policy<br />© 2026, Powered by Shopify</footer>
        </section>

        <aside className={styles.summaryColumn}>
          {session.items.map((item) => (
            <div className={styles.productRow} key={`${item.variantId}:${item.id}`}>
              <div className={styles.thumbnail}>
                {item.image ? <Image src={item.image} alt="" width={58} height={58} unoptimized /> : <span>{item.quantity}</span>}
              </div>
              <div>
                <strong>{item.title}</strong>
                <p>Quantity: {item.quantity}</p>
              </div>
              <strong>{money(item.price * item.quantity, session.currency)}</strong>
            </div>
          ))}
          <SummaryLine label="Subtotal" value={money(session.subtotal, session.currency)} />
          <SummaryLine label="Shipping" value={money(shipping, session.currency)} />
          {session.tax > 0 && <SummaryLine label="Tax" value={money(session.tax, session.currency)} />}
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

function ShippingOption({ id, active, price, currency, label, onSelect }: { id: 'standard' | 'express'; active: boolean; price: number; currency: string; label: string; onSelect: (id: 'standard' | 'express') => void }) {
  return (
    <button className={styles.shippingOption} type="button" onClick={() => onSelect(id)}>
      <span className={active ? styles.radioActive : styles.radio} />
      <span>{label}</span>
      <strong>{money(price, currency)}</strong>
    </button>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return <div className={styles.summaryLine}><span>{label}</span><strong>{value}</strong></div>;
}

function TrustItem({ title, text }: { title: string; text: string }) {
  return <div className={styles.trustItem}><span>$</span><p><strong>{title}</strong>{text}</p></div>;
}
