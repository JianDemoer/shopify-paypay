'use client';

import { useState } from 'react';
import type { PublicStoreConfig, StoreConfig } from '@/lib/store-configs';
import styles from './StoreAdmin.module.css';

type StoreForm = Partial<StoreConfig> & { adminToken?: string };
type AdminStore = PublicStoreConfig & {
  hasShopifyAdminAccessToken?: boolean;
  hasStripeSecretKey?: boolean;
  hasStripeWebhookSecret?: boolean;
  hasPaypalClientSecret?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

const emptyForm: StoreForm = {
  name: '',
  shopDomain: '',
  storefrontAccessToken: '',
  shopifyAdminAccessToken: '',
  shopifyAppProxySecret: '',
  orderMode: 'draft_order',
  stripePublishableKey: '',
  stripeSecretKey: '',
  stripeWebhookSecret: '',
  stripeWebhookSecretProd: '',
  paypalClientId: '',
  paypalClientSecret: '',
  paypalEnv: 'sandbox',
  upsellProductId: '',
  upsellVariantId: '',
};

function mask(value?: string) {
  if (!value) return 'Not set';
  if (value.length <= 8) return 'Configured';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function StoreAdmin({
  initialStores,
  adminTokenRequired = false,
}: {
  initialStores: AdminStore[];
  adminTokenRequired?: boolean;
}) {
  const [stores, setStores] = useState(initialStores);
  const [form, setForm] = useState<StoreForm>(emptyForm);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  function update(name: keyof StoreForm, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function refresh(adminToken = form.adminToken || '') {
    const response = await fetch('/api/admin/stores', {
      headers: adminToken ? { 'x-admin-token': adminToken } : {},
    });
    if (!response.ok) throw new Error('Unable to refresh stores');
    const json = await response.json();
    setStores(json.stores);
  }

  async function save() {
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/stores', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(form.adminToken ? { 'x-admin-token': form.adminToken } : {}),
        },
        body: JSON.stringify(form),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Save failed');
      await refresh(form.adminToken || '');
      setForm({ ...emptyForm, adminToken: form.adminToken });
      setMessage(`Saved ${json.store.shopDomain}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function edit(store: any) {
    setForm({
      ...emptyForm,
      adminToken: form.adminToken,
      id: store.id,
      name: store.name,
      shopDomain: store.shopDomain,
      orderMode: store.orderMode,
      stripePublishableKey: store.stripePublishableKey,
      paypalClientId: store.paypalClientId || '',
      paypalEnv: store.paypalEnv || 'sandbox',
      upsellProductId: store.upsellProductId || '',
      upsellVariantId: store.upsellVariantId || '',
    });
    setMessage('Secrets are not loaded back into the form. Re-enter them only if you want to replace them.');
  }

  return (
    <main className={styles.page}>
      <section className={styles.header}>
        <div>
          <h1>Store Configuration</h1>
          <p>Configure Shopify, Stripe, PayPal, App Proxy, Draft Order, and upsell settings per store.</p>
        </div>
        <div className={styles.count}>{stores.length} stores</div>
      </section>

      <section className={styles.grid}>
        <div className={styles.panel}>
          <h2>Add or Update Store</h2>
          <Field label="Admin token" value={form.adminToken || ''} onChange={(value) => update('adminToken', value)} password />
          {adminTokenRequired && (
            <button className={styles.secondary} type="button" onClick={() => refresh(form.adminToken || '').catch((error) => setMessage(error.message))}>
              Load stores
            </button>
          )}
          <Field label="Store name" value={form.name || ''} onChange={(value) => update('name', value)} />
          <Field label="Shop domain" value={form.shopDomain || ''} onChange={(value) => update('shopDomain', value)} placeholder="example.myshopify.com" />
          <Field label="Storefront access token" value={form.storefrontAccessToken || ''} onChange={(value) => update('storefrontAccessToken', value)} password />
          <Field label="Shopify Admin access token" value={form.shopifyAdminAccessToken || ''} onChange={(value) => update('shopifyAdminAccessToken', value)} password />
          <Field label="Shopify App Proxy secret" value={form.shopifyAppProxySecret || ''} onChange={(value) => update('shopifyAppProxySecret', value)} password />
          <label className={styles.field}>
            <span>Order mode</span>
            <select value={form.orderMode || 'draft_order'} onChange={(event) => update('orderMode', event.target.value)}>
              <option value="draft_order">Draft Order</option>
              <option value="direct_order">Direct Order</option>
            </select>
          </label>
          <Field label="Stripe publishable key" value={form.stripePublishableKey || ''} onChange={(value) => update('stripePublishableKey', value)} />
          <Field label="Stripe secret key" value={form.stripeSecretKey || ''} onChange={(value) => update('stripeSecretKey', value)} password />
          <Field label="Stripe webhook secret" value={form.stripeWebhookSecret || ''} onChange={(value) => update('stripeWebhookSecret', value)} password />
          <Field label="Stripe production webhook secret" value={form.stripeWebhookSecretProd || ''} onChange={(value) => update('stripeWebhookSecretProd', value)} password />
          <Field label="PayPal client ID" value={form.paypalClientId || ''} onChange={(value) => update('paypalClientId', value)} />
          <Field label="PayPal client secret" value={form.paypalClientSecret || ''} onChange={(value) => update('paypalClientSecret', value)} password />
          <label className={styles.field}>
            <span>PayPal environment</span>
            <select value={form.paypalEnv || 'sandbox'} onChange={(event) => update('paypalEnv', event.target.value)}>
              <option value="sandbox">Sandbox</option>
              <option value="live">Live</option>
            </select>
          </label>
          <Field label="Upsell product GID" value={form.upsellProductId || ''} onChange={(value) => update('upsellProductId', value)} />
          <Field label="Upsell variant GID" value={form.upsellVariantId || ''} onChange={(value) => update('upsellVariantId', value)} />
          <button className={styles.save} type="button" disabled={saving} onClick={save}>
            {saving ? 'Saving...' : 'Save store'}
          </button>
          {message && <div className={styles.message}>{message}</div>}
        </div>

        <div className={styles.panel}>
          <h2>Configured Stores</h2>
          <div className={styles.storeList}>
            {stores.map((store: any) => (
              <button key={store.id} type="button" className={styles.storeCard} onClick={() => edit(store)}>
                <strong>{store.name}</strong>
                <span>{store.shopDomain}</span>
                <small>Mode: {store.orderMode}</small>
                <small>Stripe: {mask(store.stripePublishableKey)}</small>
                <small>PayPal: {store.paypalClientId ? 'Configured' : 'Not set'}</small>
              </button>
            ))}
            {stores.length === 0 && <p className={styles.empty}>No stores configured yet.</p>}
          </div>
        </div>
      </section>
    </main>
  );
}

function Field({
  label,
  value,
  placeholder = '',
  password = false,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  password?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input
        type={password ? 'password' : 'text'}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
