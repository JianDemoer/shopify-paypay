'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
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

function asStep(step: string): Step {
  return STEP_ORDER.includes(step as Step) ? step as Step : 'contact';
}

function money(value: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
}

function navigate(path: string) {
  window.location.assign(new URL(path, window.location.origin).toString());
}

function contactFromSession(session: CheckoutSession): ContactState {
  return {
    email: session.customer?.email || '',
    firstName: session.customer?.firstName || '',
    lastName: session.customer?.lastName || '',
    phone: session.customer?.phone || '',
    address1: session.customer?.address1 || '',
    address2: session.customer?.address2 || '',
    city: session.customer?.city || '',
    province: session.customer?.province || '',
    country: session.customer?.country || 'United States',
    zip: session.customer?.zip || '',
  };
}

export function OmniCheckout({ initialSession, storeConfig, initialStep, cid, checkoutToken }: OmniCheckoutProps) {
  const [step, setStepState] = useState<Step>(asStep(initialStep));
  const [session, setSession] = useState(initialSession);
  const [shippingMethod, setShippingMethod] = useState<'standard' | 'express'>(initialSession.primaryShippingMethod || 'standard');
  const [contact, setContact] = useState<ContactState>(() => contactFromSession(initialSession));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const isOnePage = session.checkoutMode === 'one_page';

  const shipping = shippingMethod === 'express' ? storeConfig.expressShipping : storeConfig.standardShipping;
  const total = useMemo(
    () => Number((session.subtotal + shipping + session.tax).toFixed(2)),
    [session.subtotal, session.tax, shipping]
  );

  function setStep(nextStep: Step) {
    const url = new URL(window.location.href);
    if (nextStep === 'contact') url.searchParams.delete('step');
    else url.searchParams.set('step', nextStep);
    url.searchParams.set('cid', cid);
    window.history.pushState(null, '', url);
    setStepState(nextStep);
    setError('');
  }

  function updateContact(name: keyof ContactState, value: string) {
    setContact((current) => ({ ...current, [name]: value }));
  }

  function contactIsValid() {
    return Boolean(contact.email && contact.firstName && contact.lastName && contact.address1 && contact.city && contact.country && contact.zip);
  }

  async function saveCheckout(nextStep: Step) {
    if (!contactIsValid()) {
      setError('Please complete contact and shipping address.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/a/s/api/checkout/prepare?checkout_token=${encodeURIComponent(checkoutToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checkoutSessionId: session.id,
          shippingMethod,
          shippingAddress: contact,
          sourceUrl: window.location.href,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Unable to save order details.');
      setSession(json.session);
      setShippingMethod(json.session.primaryShippingMethod || shippingMethod);
      setStep(nextStep);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save order details.');
    } finally {
      setLoading(false);
    }
  }

  const activeIndex = STEP_ORDER.indexOf(step);
  const reviewReady = session.checkoutStatus === 'ready_for_payment' && Boolean(session.primaryDraftOrderId);

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <section className={styles.checkoutColumn}>
          <nav className={styles.stepBar} aria-label="Checkout steps">
            {STEP_ORDER.map((item, index) => (
              <span key={item} className={`${styles.stepPill} ${index <= activeIndex ? styles.stepPillActive : ''}`}>
                {item === 'contact' ? 'Contact' : item === 'shipping_method' ? 'Shipping' : 'Review'}
              </span>
            ))}
          </nav>

          <div className={styles.trustHeader}>
            <div className={styles.safeTitle}><span>1</span> Order Details</div>
            <p className={styles.muted}>Your information is saved before payment is configured.</p>
          </div>

          {(isOnePage || step === 'contact') && (
            <section className={styles.formPanel}>
              <h2>Contact information</h2>
              <FloatingInput label="Email (for order updates)" type="email" value={contact.email} onChange={(value) => updateContact('email', value)} />
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
              <FloatingInput label="Phone (for shipping updates)" value={contact.phone} onChange={(value) => updateContact('phone', value)} />

              <div className={styles.actionRow}>
                <button className={styles.backButton} type="button" onClick={() => navigate('/cart')}>Return to cart</button>
                <button className={styles.primaryButton} type="button" disabled={loading} onClick={() => saveCheckout('shipping_method')}>
                  {loading ? 'Saving order details...' : 'Continue to shipping'}
                </button>
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
                <button className={styles.backButton} type="button" onClick={() => setStep('contact')}>Return to contact</button>
                <button className={styles.primaryButton} type="button" disabled={loading} onClick={() => saveCheckout('payment_method')}>
                  {loading ? 'Saving draft order...' : 'Save and review order'}
                </button>
              </div>
            </section>
          )}

          {(isOnePage || step === 'payment_method') && (
            <section className={styles.formPanel}>
              <ReviewBox contact={contact} shippingMethod={shippingMethod} showShipping onEdit={setStep} />
              <h2>Order review</h2>
              {reviewReady ? (
                <>
                  <p className={styles.muted}>A Draft Order has been created and is waiting for a payment integration. No payment details are collected on this page.</p>
                  <div className={styles.reserve}>Draft Order saved. You can safely test the post-purchase funnel below.</div>
                  <div className={styles.actionRow}>
                    <button className={styles.backButton} type="button" onClick={() => setStep('shipping_method')}>Edit shipping</button>
                    <button
                      className={styles.primaryButton}
                      type="button"
                      onClick={() => navigate(`/a/s/checkout/${encodeURIComponent(session.id)}/upsell?cid=${encodeURIComponent(cid)}&checkout_token=${encodeURIComponent(checkoutToken)}&preview=1`)}
                    >
                      Preview offers
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className={styles.muted}>Save the contact and shipping details to create the Draft Order.</p>
                  <div className={styles.actionRow}>
                    <button className={styles.backButton} type="button" onClick={() => setStep('shipping_method')}>Return to shipping</button>
                    <button className={styles.primaryButton} type="button" disabled={loading} onClick={() => saveCheckout('payment_method')}>
                      {loading ? 'Saving draft order...' : 'Save order details'}
                    </button>
                  </div>
                </>
              )}
            </section>
          )}

          {error && <div className={styles.error} role="alert">{error}</div>}
          <div className={styles.footerBadges}>Draft Order workflow active. Payment collection is disabled.</div>
          <footer className={styles.footer}>Privacy policy<br />Powered by Shopify</footer>
        </section>

        <aside className={styles.summaryColumn}>
          {session.items.map((item) => (
            <div className={styles.productRow} key={`${item.variantId}:${item.id}`}>
              <div className={styles.thumbnail}>
                {item.image ? <Image src={item.image} alt="" width={58} height={58} unoptimized /> : <span>{item.quantity}</span>}
              </div>
              <div><strong>{item.title}</strong><p>Quantity: {item.quantity}</p></div>
              <strong>{money(item.price * item.quantity, session.currency)}</strong>
            </div>
          ))}
          <SummaryLine label="Subtotal" value={money(session.subtotal, session.currency)} />
          <SummaryLine label="Shipping" value={money(shipping, session.currency)} />
          {session.tax > 0 && <SummaryLine label="Tax" value={money(session.tax, session.currency)} />}
          <div className={styles.totalRow}><span>Total</span><strong>{session.currency} {money(total, session.currency)}</strong></div>
          <div className={styles.why}>Why choose us?</div>
          <TrustItem title="180-Day Money-Back Satisfaction Guarantee" text="If you are not satisfied with the products, we will give you a full refund." />
          <TrustItem title="More than 20,000 orders successfully shipped." text="We have gained as many satisfied customers as orders we have shipped." />
        </aside>
      </main>
    </div>
  );
}

function FloatingInput({ label, value, type = 'text', onChange }: { label: string; value: string; type?: string; onChange: (value: string) => void }) {
  return <label className={styles.field}><span>{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function ReviewBox({ contact, shippingMethod, showShipping, onEdit }: { contact: ContactState; shippingMethod: string; showShipping: boolean; onEdit: (step: Step) => void }) {
  return (
    <div className={styles.reviewBox}>
      <div><span>Contact</span><strong>{contact.email || 'Not saved yet'}</strong><button type="button" onClick={() => onEdit('contact')}>Edit</button></div>
      <div><span>Ship to</span><strong>{contact.address1 ? `${contact.address1}, ${contact.city}, ${contact.province}, ${contact.country}, ${contact.zip}` : 'Not saved yet'}</strong><button type="button" onClick={() => onEdit('contact')}>Edit</button></div>
      {showShipping && <div><span>Shipping</span><strong>{shippingMethod === 'express' ? 'Express worldwide shipping' : 'Standard Shipping (180-day refund policy)'}</strong><button type="button" onClick={() => onEdit('shipping_method')}>Edit</button></div>}
    </div>
  );
}

function ShippingOption({ id, active, price, currency, label, onSelect }: { id: 'standard' | 'express'; active: boolean; price: number; currency: string; label: string; onSelect: (id: 'standard' | 'express') => void }) {
  return <button className={styles.shippingOption} type="button" onClick={() => onSelect(id)}><span className={active ? styles.radioActive : styles.radio} /><span>{label}</span><strong>{money(price, currency)}</strong></button>;
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return <div className={styles.summaryLine}><span>{label}</span><strong>{value}</strong></div>;
}

function TrustItem({ title, text }: { title: string; text: string }) {
  return <div className={styles.trustItem}><span>$</span><p><strong>{title}</strong>{text}</p></div>;
}
