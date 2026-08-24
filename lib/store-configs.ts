import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

export interface StoreConfig {
  id: string;
  name: string;
  shopDomain: string;
  storefrontAccessToken?: string;
  shopifyAdminAccessToken: string;
  shopifyAppProxySecret?: string;
  orderMode: 'direct_order' | 'draft_order';
  stripePublishableKey: string;
  stripeSecretKey: string;
  stripeWebhookSecret?: string;
  stripeWebhookSecretProd?: string;
  paypalClientId?: string;
  paypalClientSecret?: string;
  paypalEnv: 'sandbox' | 'live';
  upsellProductId?: string;
  upsellVariantId?: string;
  createdAt: string;
  updatedAt: string;
}

export type PublicStoreConfig = Pick<
  StoreConfig,
  'id' | 'name' | 'shopDomain' | 'orderMode' | 'stripePublishableKey' | 'paypalClientId' | 'paypalEnv' | 'upsellProductId' | 'upsellVariantId'
>;

const DATA_DIR = process.env.CHECKOUT_SESSION_DATA_DIR || path.join(process.cwd(), '.data');
const CONFIG_PATH = path.join(DATA_DIR, 'store-configs.json');

function slug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeDomain(value: string) {
  return slug(value).replace(/\/$/, '');
}

function fallbackStore(): StoreConfig | null {
  const shopDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const adminToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const stripePublishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

  if (!shopDomain || !adminToken || !stripeSecretKey || !stripePublishableKey) {
    return null;
  }

  const now = new Date().toISOString();
  return {
    id: normalizeDomain(shopDomain),
    name: normalizeDomain(shopDomain),
    shopDomain: normalizeDomain(shopDomain),
    storefrontAccessToken: process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN,
    shopifyAdminAccessToken: adminToken,
    shopifyAppProxySecret: process.env.SHOPIFY_APP_PROXY_SECRET || process.env.SHOPIFY_API_SECRET,
    orderMode: process.env.SHOPIFY_ORDER_MODE === 'draft_order' ? 'draft_order' : 'direct_order',
    stripePublishableKey,
    stripeSecretKey,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    stripeWebhookSecretProd: process.env.STRIPE_WEBHOOK_SECRET_PROD,
    paypalClientId: process.env.PAYPAL_CLIENT_ID || process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID,
    paypalClientSecret: process.env.PAYPAL_CLIENT_SECRET,
    paypalEnv: process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox',
    upsellProductId: process.env.NEXT_PUBLIC_UPSELL_PRODUCT_ID,
    upsellVariantId: process.env.NEXT_PUBLIC_UPSELL_VARIANT_ID,
    createdAt: now,
    updatedAt: now,
  };
}

async function readConfigFile(): Promise<StoreConfig[]> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    return JSON.parse(raw) as StoreConfig[];
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
    const fallback = fallbackStore();
    return fallback ? [fallback] : [];
  }
}

async function writeConfigFile(configs: StoreConfig[]) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(configs, null, 2));
}

export function publicStoreConfig(config: StoreConfig): PublicStoreConfig {
  return {
    id: config.id,
    name: config.name,
    shopDomain: config.shopDomain,
    orderMode: config.orderMode,
    stripePublishableKey: config.stripePublishableKey,
    paypalClientId: config.paypalClientId,
    paypalEnv: config.paypalEnv,
    upsellProductId: config.upsellProductId,
    upsellVariantId: config.upsellVariantId,
  };
}

export async function listStoreConfigs() {
  return readConfigFile();
}

export async function getStoreConfig(storeIdOrDomain?: string | null): Promise<StoreConfig> {
  const configs = await readConfigFile();
  const normalized = storeIdOrDomain ? normalizeDomain(storeIdOrDomain) : '';
  const config = configs.find((item) =>
    item.id === normalized || item.shopDomain === normalized
  ) || configs[0];

  if (!config) {
    throw new Error('No store configuration found. Add one at /admin/stores first.');
  }

  return config;
}

export async function saveStoreConfig(input: Partial<StoreConfig>) {
  const configs = await readConfigFile();
  const now = new Date().toISOString();
  const shopDomain = normalizeDomain(input.shopDomain || '');

  if (!shopDomain) throw new Error('Shop domain is required');
  const id = input.id ? slug(input.id) : shopDomain;
  const existingIndex = configs.findIndex((item) => item.id === id || item.shopDomain === shopDomain);
  const existing = existingIndex >= 0 ? configs[existingIndex] : null;
  const shopifyAdminAccessToken = input.shopifyAdminAccessToken?.trim() || existing?.shopifyAdminAccessToken || '';
  const stripeSecretKey = input.stripeSecretKey?.trim() || existing?.stripeSecretKey || '';

  if (!shopifyAdminAccessToken) throw new Error('Shopify Admin access token is required');
  if (!input.stripePublishableKey && !existing?.stripePublishableKey) throw new Error('Stripe publishable key is required');
  if (!stripeSecretKey) throw new Error('Stripe secret key is required');

  const config: StoreConfig = {
    id,
    name: input.name?.trim() || shopDomain,
    shopDomain,
    storefrontAccessToken: input.storefrontAccessToken?.trim() || existing?.storefrontAccessToken || '',
    shopifyAdminAccessToken,
    shopifyAppProxySecret: input.shopifyAppProxySecret?.trim() || existing?.shopifyAppProxySecret || '',
    orderMode: input.orderMode === 'draft_order' ? 'draft_order' : 'direct_order',
    stripePublishableKey: input.stripePublishableKey?.trim() || existing?.stripePublishableKey || '',
    stripeSecretKey,
    stripeWebhookSecret: input.stripeWebhookSecret?.trim() || existing?.stripeWebhookSecret || '',
    stripeWebhookSecretProd: input.stripeWebhookSecretProd?.trim() || existing?.stripeWebhookSecretProd || '',
    paypalClientId: input.paypalClientId?.trim() || '',
    paypalClientSecret: input.paypalClientSecret?.trim() || existing?.paypalClientSecret || '',
    paypalEnv: input.paypalEnv === 'live' ? 'live' : 'sandbox',
    upsellProductId: input.upsellProductId?.trim() || '',
    upsellVariantId: input.upsellVariantId?.trim() || '',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  if (existingIndex >= 0) {
    configs[existingIndex] = config;
  } else {
    configs.push(config);
  }

  await writeConfigFile(configs);
  return config;
}

export async function deleteStoreConfig(id: string) {
  const configs = await readConfigFile();
  const normalized = slug(id);
  await writeConfigFile(configs.filter((item) => item.id !== normalized));
}
