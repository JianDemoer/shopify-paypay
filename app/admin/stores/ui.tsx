'use client';

import { useState } from 'react';
import type { PublicStoreConfig, StoreConfig } from '@/lib/store-configs';
import styles from './StoreAdmin.module.css';

type StoreForm = Partial<StoreConfig> & { adminToken?: string; checkoutZonesJson: string; funnelsJson: string };
export type AdminLocale = 'zh' | 'en';
type AdminStore = PublicStoreConfig & {
  hasShopifyAdminAccessToken?: boolean;
  hasShopifyAppProxySecret?: boolean;
  hasStripeSecretKey?: boolean;
  hasStripeWebhookSecret?: boolean;
  hasPaypalClientSecret?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type StatusMessage =
  | { kind: 'saved'; domain: string }
  | { kind: 'installed'; domain: string }
  | { kind: 'editSecrets' }
  | { kind: 'error'; text: string };

const translations = {
  zh: {
    pageTitle: '店铺配置',
    pageDescription: 'Shopify 安装连接自动管理；这里仅配置订单规则、支付渠道、配送、漏斗和加购。',
    storeCount: (count: number) => `${count} 个店铺`,
    formTitle: '店铺业务配置',
    listTitle: '已配置店铺',
    loadStores: '加载店铺',
    saving: '保存中...',
    saveStore: '保存店铺',
    noStores: '尚未配置店铺。',
    mode: '订单模式',
    stripe: 'Stripe',
    paypal: 'PayPal',
    configured: '已配置',
    notSet: '未配置',
    connected: '已连接',
    disconnected: '未连接，需要重新安装 App',
    reinstall: '重新安装 Shopify App 后会自动恢复连接参数。',
    automatic: '自动管理',
    optional: '可选',
    saved: (domain: string) => `已保存 ${domain}`,
    installed: (domain: string) => `${domain} 已成功连接 Shopify。`,
    editSecrets: '出于安全原因，密钥不会回填。仅在需要替换密钥时重新输入。',
    fields: {
      adminToken: '后台管理令牌',
      storeName: '店铺名称',
      shopDomain: 'Shopify 店铺域名',
      currency: '货币',
      shopifyConnection: 'Shopify App 连接',
      catalog: '商品目录来源',
      appProxy: 'App Proxy',
      orderMode: '订单模式',
      stripePublishableKey: 'Stripe 可发布密钥',
      stripeSecretKey: 'Stripe 私钥',
      stripeWebhookSecret: 'Stripe Webhook 密钥',
      stripeWebhookSecretProd: 'Stripe 正式环境 Webhook 密钥',
      paypalClientId: 'PayPal Client ID',
      paypalClientSecret: 'PayPal Client Secret',
      paypalEnvironment: 'PayPal 环境',
      upsellProductId: '加购商品 GID',
      upsellVariantId: '加购变体 GID',
      standardShipping: '标准配送费',
      expressShipping: '快速配送费',
      taxRate: '税率（0 到 1）',
      checkoutZones: 'Checkout Zones JSON',
      funnels: 'Funnel Versions JSON',
    },
    orderModes: { draft_order: 'Draft Order（草稿订单）', direct_order: 'Direct Order（直接订单）' },
    paypalEnvironments: { sandbox: 'Sandbox（沙盒）', live: 'Live（正式环境）' },
    errors: {
      'Unauthorized': '管理令牌无效或无权访问。',
      'Unable to refresh stores': '无法加载店铺配置。',
      'Save failed': '保存店铺失败。',
      'Failed to save store': '保存店铺失败。',
      'A valid shop domain is required': '请输入有效的 Shopify 店铺域名。',
      'Stripe publishable key is required': '请输入 Stripe 可发布密钥。',
      'Stripe secret key is required': '请输入 Stripe 私钥。',
    } as Record<string, string>,
  },
  en: {
    pageTitle: 'Store Configuration',
    pageDescription: 'Shopify installation is managed automatically; configure order rules, payments, shipping, funnels, and upsells here.',
    storeCount: (count: number) => `${count} ${count === 1 ? 'store' : 'stores'}`,
    formTitle: 'Store Business Configuration',
    listTitle: 'Configured Stores',
    loadStores: 'Load stores',
    saving: 'Saving...',
    saveStore: 'Save store',
    noStores: 'No stores configured yet.',
    mode: 'Mode',
    stripe: 'Stripe',
    paypal: 'PayPal',
    configured: 'Configured',
    notSet: 'Not set',
    connected: 'Connected',
    disconnected: 'Disconnected. Reinstall the app.',
    reinstall: 'Reinstalling the Shopify app restores the connection automatically.',
    automatic: 'Automatic',
    optional: 'Optional',
    saved: (domain: string) => `Saved ${domain}`,
    installed: (domain: string) => `${domain} connected to Shopify successfully.`,
    editSecrets: 'Secrets are not loaded back into the form. Re-enter them only if you want to replace them.',
    fields: {
      adminToken: 'Admin token',
      storeName: 'Store name',
      shopDomain: 'Shop domain',
      currency: 'Currency',
      shopifyConnection: 'Shopify App connection',
      catalog: 'Catalog source',
      appProxy: 'App Proxy',
      orderMode: 'Order mode',
      stripePublishableKey: 'Stripe publishable key',
      stripeSecretKey: 'Stripe secret key',
      stripeWebhookSecret: 'Stripe webhook secret',
      stripeWebhookSecretProd: 'Stripe production webhook secret',
      paypalClientId: 'PayPal client ID',
      paypalClientSecret: 'PayPal client secret',
      paypalEnvironment: 'PayPal environment',
      upsellProductId: 'Upsell product GID',
      upsellVariantId: 'Upsell variant GID',
      standardShipping: 'Standard shipping',
      expressShipping: 'Express shipping',
      taxRate: 'Tax rate (0 to 1)',
      checkoutZones: 'Checkout Zones JSON',
      funnels: 'Funnel versions JSON',
    },
    orderModes: { draft_order: 'Draft Order', direct_order: 'Direct Order' },
    paypalEnvironments: { sandbox: 'Sandbox', live: 'Live' },
    errors: {} as Record<string, string>,
  },
};

const emptyForm: StoreForm = {
  name: '',
  shopDomain: '',
  currency: 'USD',
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
  standardShipping: 3.99,
  expressShipping: 5.99,
  taxRate: 0,
  checkoutZonesJson: '[]',
  funnelsJson: '[]',
};

function mask(value: string | undefined, configured: string, notSet: string) {
  if (!value) return notSet;
  if (value.length <= 8) return configured;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function statusText(message: StatusMessage, locale: AdminLocale) {
  const t = translations[locale];
  if (message.kind === 'installed') return t.installed(message.domain);
  if (message.kind === 'saved') return t.saved(message.domain);
  if (message.kind === 'editSecrets') return t.editSecrets;
  return t.errors[message.text] || message.text;
}

function storeForm(store: AdminStore, adminToken = ''): StoreForm {
  return {
    ...emptyForm,
    adminToken,
    id: store.id,
    name: store.name,
    shopDomain: store.shopDomain,
    currency: store.currency || 'USD',
    orderMode: store.orderMode,
    stripePublishableKey: store.stripePublishableKey,
    paypalClientId: store.paypalClientId || '',
    paypalEnv: store.paypalEnv || 'sandbox',
    upsellProductId: store.upsellProductId || '',
    upsellVariantId: store.upsellVariantId || '',
    checkoutZonesJson: JSON.stringify(store.checkoutZones || [], null, 2),
    funnelsJson: JSON.stringify(store.funnels || [], null, 2),
    standardShipping: store.standardShipping ?? 3.99,
    expressShipping: store.expressShipping ?? 5.99,
    taxRate: store.taxRate ?? 0,
  };
}

export function StoreAdmin({
  initialStores,
  adminTokenRequired = false,
  initialLocale = 'en',
  installedShop,
  selectedShop,
}: {
  initialStores: AdminStore[];
  adminTokenRequired?: boolean;
  initialLocale?: AdminLocale;
  installedShop?: string;
  selectedShop?: string;
}) {
  const [locale, setLocale] = useState<AdminLocale>(initialLocale);
  const [stores, setStores] = useState(initialStores);
  const [form, setForm] = useState<StoreForm>(() => {
    const initialShop = selectedShop || installedShop;
    const installedStore = initialShop
      ? initialStores.find((store) => store.shopDomain === initialShop)
      : undefined;
    return installedStore ? storeForm(installedStore) : emptyForm;
  });
  const [message, setMessage] = useState<StatusMessage | null>(installedShop ? { kind: 'installed', domain: installedShop } : null);
  const [saving, setSaving] = useState(false);
  const t = translations[locale];
  const selectedStore = form.id ? stores.find((store) => store.id === form.id) : undefined;
  const shopifyConnected = Boolean(selectedStore?.hasShopifyAdminAccessToken && selectedStore?.hasShopifyAppProxySecret);

  function changeLocale(nextLocale: AdminLocale) {
    setLocale(nextLocale);
    document.cookie = `admin_locale=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  function update(name: keyof StoreForm, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function refresh(adminToken = form.adminToken || '') {
    const response = await fetch('/api/admin/stores', {
      headers: adminToken ? { 'x-admin-token': adminToken } : {},
    });
    if (!response.ok) {
      const json = await response.json().catch(() => ({}));
      throw new Error(json.error || 'Unable to refresh stores');
    }
    const json = await response.json();
    setStores(json.stores);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      let checkoutZones: unknown;
      let funnels: unknown;
      try {
        checkoutZones = JSON.parse(form.checkoutZonesJson || '[]');
        funnels = JSON.parse(form.funnelsJson || '[]');
      } catch {
        throw new Error(locale === 'zh' ? 'Zone 或 Funnel JSON 格式无效。' : 'Zone or Funnel JSON is invalid.');
      }
      const { checkoutZonesJson: _zones, funnelsJson: _funnels, ...storeFields } = form;
      const response = await fetch('/api/admin/stores', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(form.adminToken ? { 'x-admin-token': form.adminToken } : {}),
        },
        body: JSON.stringify({ ...storeFields, checkoutZones, funnels }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Save failed');
      await refresh(form.adminToken || '');
      setForm(storeForm(json.store, form.adminToken));
      setMessage({ kind: 'saved', domain: json.store.shopDomain });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  }

  function edit(store: AdminStore) {
    setForm(storeForm(store, form.adminToken));
    setMessage({ kind: 'editSecrets' });
  }

  return (
    <main className={styles.page} lang={locale === 'zh' ? 'zh-CN' : 'en'}>
      <section className={styles.header}>
        <div>
          <h1>{t.pageTitle}</h1>
          <p>{t.pageDescription}</p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.languageSwitch} role="group" aria-label={locale === 'zh' ? '语言选择' : 'Language selection'}>
            <button type="button" className={locale === 'zh' ? styles.languageActive : ''} aria-pressed={locale === 'zh'} onClick={() => changeLocale('zh')}>中文</button>
            <button type="button" className={locale === 'en' ? styles.languageActive : ''} aria-pressed={locale === 'en'} onClick={() => changeLocale('en')}>EN</button>
          </div>
          <div className={styles.count}>{t.storeCount(stores.length)}</div>
          <a className={styles.reportsLink} href="/admin/reports">{locale === 'zh' ? '报表' : 'Reports'}</a>
        </div>
      </section>

      <section className={styles.grid}>
        <div className={styles.panel}>
          <h2>{t.formTitle}</h2>
          {adminTokenRequired && (
            <>
              <Field label={t.fields.adminToken} value={form.adminToken || ''} onChange={(value) => update('adminToken', value)} password />
              <button className={styles.secondary} type="button" onClick={() => refresh(form.adminToken || '').catch((error) => setMessage({ kind: 'error', text: error.message }))}>
                {t.loadStores}
              </button>
            </>
          )}
          <Field label={t.fields.storeName} value={form.name || ''} onChange={(value) => update('name', value)} />
          <Field label={t.fields.shopDomain} value={form.shopDomain || ''} onChange={(value) => update('shopDomain', value)} placeholder="example.myshopify.com" readOnly={Boolean(form.id)} />
          <Field label={t.fields.currency} value={form.currency || 'USD'} onChange={(value) => update('currency', value)} placeholder="USD" />
          <div className={styles.connectionNotice}>
            <strong>{t.fields.shopifyConnection}</strong>
            <span>{shopifyConnected ? `${t.connected} · ${t.automatic}` : t.disconnected}</span>
            <small>{shopifyConnected
              ? `${t.fields.catalog}: ${t.automatic}; ${t.fields.appProxy}: ${t.automatic}`
              : t.reinstall}</small>
          </div>
          <label className={styles.field}>
            <span>{t.fields.orderMode}</span>
            <select value={form.orderMode || 'draft_order'} onChange={(event) => update('orderMode', event.target.value)}>
              <option value="draft_order">{t.orderModes.draft_order}</option>
              <option value="direct_order">{t.orderModes.direct_order}</option>
            </select>
          </label>
          <Field label={t.fields.stripePublishableKey} value={form.stripePublishableKey || ''} onChange={(value) => update('stripePublishableKey', value)} />
          <Field label={t.fields.stripeSecretKey} value={form.stripeSecretKey || ''} onChange={(value) => update('stripeSecretKey', value)} password />
          <Field label={t.fields.stripeWebhookSecret} value={form.stripeWebhookSecret || ''} onChange={(value) => update('stripeWebhookSecret', value)} password />
          <Field label={t.fields.stripeWebhookSecretProd} value={form.stripeWebhookSecretProd || ''} onChange={(value) => update('stripeWebhookSecretProd', value)} password />
          <Field label={t.fields.paypalClientId} value={form.paypalClientId || ''} onChange={(value) => update('paypalClientId', value)} />
          <Field label={t.fields.paypalClientSecret} value={form.paypalClientSecret || ''} onChange={(value) => update('paypalClientSecret', value)} password />
          <label className={styles.field}>
            <span>{t.fields.paypalEnvironment}</span>
            <select value={form.paypalEnv || 'sandbox'} onChange={(event) => update('paypalEnv', event.target.value)}>
              <option value="sandbox">{t.paypalEnvironments.sandbox}</option>
              <option value="live">{t.paypalEnvironments.live}</option>
            </select>
          </label>
          <Field label={t.fields.upsellProductId} value={form.upsellProductId || ''} onChange={(value) => update('upsellProductId', value)} />
          <Field label={t.fields.upsellVariantId} value={form.upsellVariantId || ''} onChange={(value) => update('upsellVariantId', value)} />
          <Field label={t.fields.standardShipping} value={String(form.standardShipping ?? 3.99)} onChange={(value) => update('standardShipping', value)} />
          <Field label={t.fields.expressShipping} value={String(form.expressShipping ?? 5.99)} onChange={(value) => update('expressShipping', value)} />
          <Field label={t.fields.taxRate} value={String(form.taxRate ?? 0)} onChange={(value) => update('taxRate', value)} />
          <label className={styles.field}>
            <span>{t.fields.checkoutZones}</span>
            <textarea className={styles.codeField} value={form.checkoutZonesJson || '[]'} onChange={(event) => update('checkoutZonesJson', event.target.value)} spellCheck={false} rows={9} />
          </label>
          <label className={styles.field}>
            <span>{t.fields.funnels}</span>
            <textarea className={styles.codeField} value={form.funnelsJson || '[]'} onChange={(event) => update('funnelsJson', event.target.value)} spellCheck={false} rows={15} />
          </label>
          <button className={styles.save} type="button" disabled={saving} onClick={save}>
            {saving ? t.saving : t.saveStore}
          </button>
          {message && <div className={styles.message} role="status">{statusText(message, locale)}</div>}
        </div>

        <div className={styles.panel}>
          <h2>{t.listTitle}</h2>
          <div className={styles.storeList}>
            {stores.map((store) => (
              <button key={store.id} type="button" className={styles.storeCard} onClick={() => edit(store)}>
                <strong>{store.name}</strong>
                <span>{store.shopDomain}</span>
                <small>{t.fields.shopifyConnection}: {store.hasShopifyAdminAccessToken ? t.connected : t.notSet}</small>
                <small>{t.fields.catalog}: {store.hasShopifyAdminAccessToken ? t.automatic : t.notSet}</small>
                <small>{t.fields.appProxy}: {store.hasShopifyAppProxySecret ? t.automatic : t.notSet}</small>
                <small>{t.mode}: {t.orderModes[store.orderMode] || store.orderMode}</small>
                <small>{t.stripe}: {mask(store.stripePublishableKey, t.configured, t.notSet)}</small>
                <small>{t.paypal}: {store.paypalClientId ? t.configured : t.notSet}</small>
                <small>{t.fields.checkoutZones}: {(store.checkoutZones || []).length}</small>
                <small>{t.fields.funnels}: {(store.funnels || []).length}</small>
              </button>
            ))}
            {stores.length === 0 && <p className={styles.empty}>{t.noStores}</p>}
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
  readOnly = false,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  password?: boolean;
  readOnly?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input
        type={password ? 'password' : 'text'}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
