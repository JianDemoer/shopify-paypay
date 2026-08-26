import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import { isProductionRuntime } from './runtime';
import type { CheckoutZone, FunnelConfig } from './funnel-configs';
import { normalizeCheckoutZones, normalizeFunnelConfigs } from './funnel-configs';
import { upstashRestConfig } from './upstash-config';
import { shopifyClientSecrets } from './shopify-oauth';

export interface StoreConfig {
  id: string;
  name: string;
  shopDomain: string;
  currency: string;
  storefrontAccessToken?: string;
  shopifyAdminAccessToken: string;
  shopifyAppProxySecret?: string;
  shopifyScopes?: string;
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
  checkoutZones?: CheckoutZone[];
  funnels?: FunnelConfig[];
  standardShipping: number;
  expressShipping: number;
  taxRate: number;
  createdAt: string;
  updatedAt: string;
}

export type PublicStoreConfig = Pick<
  StoreConfig,
  'id' | 'name' | 'shopDomain' | 'currency' | 'orderMode' | 'stripePublishableKey' | 'paypalClientId' | 'paypalEnv' | 'upsellProductId' | 'upsellVariantId' | 'checkoutZones' | 'funnels' | 'standardShipping' | 'expressShipping' | 'taxRate'
>;

export class StoreConfigResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreConfigResolutionError';
  }
}

const DATA_DIR = process.env.CHECKOUT_SESSION_DATA_DIR || path.join(process.cwd(), '.data');
const CONFIG_PATH = path.join(DATA_DIR, 'store-configs.json');
const CONFIG_REDIS_KEY = 'omni_checkout:store_configs';
const CONFIG_REDIS_LOCK_KEY = `${CONFIG_REDIS_KEY}:write_lock`;
const { url: REDIS_URL, token: REDIS_TOKEN } = upstashRestConfig();
const globalForStoreConfigs = globalThis as typeof globalThis & {
  __storeConfigWriteTail?: Promise<void>;
};

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

function normalizeCurrency(value: string | undefined) {
  const currency = String(value || 'USD').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : 'USD';
}

function numberSetting(value: unknown, fallback: number, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Number(parsed.toFixed(2))));
}

function normalizeStoredConfigs(value: unknown): StoreConfig[] {
  if (!Array.isArray(value)) throw new Error('Invalid store configuration data');

  return value.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid store configuration entry');
    const config = raw as Partial<StoreConfig>;
    return {
      ...config,
      currency: normalizeCurrency(config.currency),
      checkoutZones: normalizeCheckoutZones(config.checkoutZones),
      funnels: normalizeFunnelConfigs(config.funnels, {
        variantId: config.upsellVariantId,
        productId: config.upsellProductId,
      }),
      standardShipping: numberSetting(config.standardShipping, 3.99),
      expressShipping: numberSetting(config.expressShipping, 5.99),
      taxRate: numberSetting(config.taxRate, 0, 0, 1),
    } as StoreConfig;
  });
}

function encryptionKey() {
  const configured = process.env.CONFIG_ENCRYPTION_KEY;
  if (!configured && isProductionRuntime()) {
    throw new Error('CONFIG_ENCRYPTION_KEY is required in production');
  }
  return crypto.createHash('sha256').update(configured || 'local-development-config-key').digest();
}

function encrypt(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return JSON.stringify({
    encrypted: true,
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    data: encrypted.toString('base64url'),
  });
}

function decrypt(value: string) {
  const parsed = JSON.parse(value) as { encrypted?: boolean; iv?: string; tag?: string; data?: string };
  if (!parsed.encrypted) {
    if (isProductionRuntime()) {
      throw new Error('Plaintext store configuration is not allowed in production');
    }
    return value;
  }
  if (!parsed.iv || !parsed.tag || !parsed.data) throw new Error('Invalid encrypted store configuration');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(parsed.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(parsed.tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(parsed.data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

async function redisCommand(command: unknown[]) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  const response = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error(`Upstash Redis error: ${response.status}`);
  return response.json();
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withConfigWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = globalForStoreConfigs.__storeConfigWriteTail || Promise.resolve();
  let releaseLocalLock = () => {};
  const current = new Promise<void>((resolve) => {
    releaseLocalLock = resolve;
  });
  globalForStoreConfigs.__storeConfigWriteTail = previous.catch(() => undefined).then(() => current);
  await previous.catch(() => undefined);

  let redisLockToken = '';
  let redisLockAcquired = false;
  try {
    if (REDIS_URL && REDIS_TOKEN) {
      redisLockToken = crypto.randomUUID();
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const result = await redisCommand(['SET', CONFIG_REDIS_LOCK_KEY, redisLockToken, 'NX', 'PX', 30_000]);
        if (result?.result === 'OK') {
          redisLockAcquired = true;
          break;
        }
        await delay(100);
      }
      if (!redisLockAcquired) throw new Error('Store configuration is busy; retry the request');
    }
    return await operation();
  } finally {
    if (redisLockAcquired) {
      await redisCommand([
        'EVAL',
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        CONFIG_REDIS_LOCK_KEY,
        redisLockToken,
      ]).catch((error) => console.error('Store configuration lock release failed:', error));
    }
    releaseLocalLock();
  }
}

function fallbackStore(): StoreConfig | null {
  const shopDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const adminToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const stripePublishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

  if (!shopDomain || !adminToken) {
    return null;
  }

  const now = new Date().toISOString();
  return {
    id: normalizeDomain(shopDomain),
    name: normalizeDomain(shopDomain),
    shopDomain: normalizeDomain(shopDomain),
    currency: normalizeCurrency(process.env.SHOPIFY_CURRENCY),
    storefrontAccessToken: process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN,
    shopifyAdminAccessToken: adminToken,
    shopifyAppProxySecret: process.env.SHOPIFY_APP_PROXY_SECRET || process.env.SHOPIFY_API_SECRET,
    shopifyScopes: process.env.SHOPIFY_API_SCOPES || '',
    orderMode: process.env.SHOPIFY_ORDER_MODE === 'draft_order' ? 'draft_order' : 'direct_order',
    stripePublishableKey: stripePublishableKey || '',
    stripeSecretKey: stripeSecretKey || '',
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    stripeWebhookSecretProd: process.env.STRIPE_WEBHOOK_SECRET_PROD,
    paypalClientId: process.env.PAYPAL_CLIENT_ID || process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID,
    paypalClientSecret: process.env.PAYPAL_CLIENT_SECRET,
    paypalEnv: process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox',
    upsellProductId: process.env.NEXT_PUBLIC_UPSELL_PRODUCT_ID,
    upsellVariantId: process.env.NEXT_PUBLIC_UPSELL_VARIANT_ID,
    checkoutZones: [],
    funnels: normalizeFunnelConfigs([], {
      variantId: process.env.NEXT_PUBLIC_UPSELL_VARIANT_ID,
      productId: process.env.NEXT_PUBLIC_UPSELL_PRODUCT_ID,
    }),
    standardShipping: numberSetting(process.env.SHOPIFY_STANDARD_SHIPPING, 3.99),
    expressShipping: numberSetting(process.env.SHOPIFY_EXPRESS_SHIPPING, 5.99),
    taxRate: numberSetting(process.env.SHOPIFY_TAX_RATE, 0, 0, 1),
    createdAt: now,
    updatedAt: now,
  };
}

async function readConfigFile(): Promise<StoreConfig[]> {
  if (REDIS_URL && REDIS_TOKEN) {
    const raw = (await redisCommand(['GET', CONFIG_REDIS_KEY]))?.result;
    if (raw) return normalizeStoredConfigs(JSON.parse(decrypt(raw)));
    const fallback = fallbackStore();
    return fallback ? [fallback] : [];
  }

  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    return normalizeStoredConfigs(JSON.parse(decrypt(raw)));
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
    const fallback = fallbackStore();
    return fallback ? [fallback] : [];
  }
}

async function writeConfigFile(configs: StoreConfig[]) {
  if (isProductionRuntime() && (!REDIS_URL || !REDIS_TOKEN)) {
    throw new Error('Upstash Redis is required for production store configuration');
  }
  const serialized = encrypt(JSON.stringify(configs, null, 2));
  if (REDIS_URL && REDIS_TOKEN) {
    await redisCommand(['SET', CONFIG_REDIS_KEY, serialized]);
    return;
  }
  await mkdir(DATA_DIR, { recursive: true });
  const temporaryPath = `${CONFIG_PATH}.${process.pid}.tmp`;
  await writeFile(temporaryPath, serialized, { mode: 0o600 });
  await rename(temporaryPath, CONFIG_PATH);
}

export function publicStoreConfig(config: StoreConfig): PublicStoreConfig {
  return {
    id: config.id,
    name: config.name,
    shopDomain: config.shopDomain,
    currency: config.currency || 'USD',
    orderMode: config.orderMode,
    stripePublishableKey: config.stripePublishableKey,
    paypalClientId: config.paypalClientId,
    paypalEnv: config.paypalEnv,
    upsellProductId: config.upsellProductId,
    upsellVariantId: config.upsellVariantId,
    checkoutZones: config.checkoutZones || [],
    funnels: config.funnels || [],
    standardShipping: config.standardShipping ?? 3.99,
    expressShipping: config.expressShipping ?? 5.99,
    taxRate: config.taxRate ?? 0,
  };
}

export async function listStoreConfigs() {
  return readConfigFile();
}

export async function getStoreConfig(storeIdOrDomain?: string | null): Promise<StoreConfig> {
  const configs = await readConfigFile();
  const normalized = storeIdOrDomain ? normalizeDomain(storeIdOrDomain) : '';
  const config = normalized
    ? configs.find((item) => item.id === normalized || item.shopDomain === normalized)
    : configs.length === 1 ? configs[0] : undefined;

  if (!config) {
    throw new StoreConfigResolutionError(
      normalized
        ? 'Unknown store configuration'
        : configs.length === 0
          ? 'No store configuration is available'
          : 'Store identifier is required when multiple stores are configured'
    );
  }

  return config;
}

export async function saveStoreConfig(input: Partial<StoreConfig>) {
  return withConfigWriteLock(async () => {
    const configs = await readConfigFile();
    const now = new Date().toISOString();
    const shopDomain = normalizeDomain(input.shopDomain || '');

  if (!shopDomain || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(shopDomain)) {
    throw new Error('A valid shop domain is required');
  }
  const inputId = input.id ? slug(input.id) : '';
  const existingIndex = configs.findIndex((item) => item.id === inputId || item.shopDomain === shopDomain);
  const existing = existingIndex >= 0 ? configs[existingIndex] : null;

  // Shopify connection data is created only by the OAuth callback. Keeping it
  // out of this endpoint prevents a configuration request from attaching one
  // store's Admin token to another store.
  if (!existing) throw new Error('Install the Shopify app before editing a store');
  if (existing.shopDomain !== shopDomain || (inputId && existing.id !== inputId)) {
    throw new Error('A Shopify store domain cannot be changed after installation');
  }
  const id = existing.id;

  const config: StoreConfig = {
    id,
    name: input.name?.trim() || shopDomain,
    shopDomain,
    currency: normalizeCurrency(input.currency || existing?.currency),
    storefrontAccessToken: existing.storefrontAccessToken || '',
    shopifyAdminAccessToken: existing.shopifyAdminAccessToken || '',
    shopifyAppProxySecret: existing.shopifyAppProxySecret || '',
    shopifyScopes: existing.shopifyScopes || '',
    orderMode: input.orderMode === 'draft_order' ? 'draft_order' : 'direct_order',
    stripePublishableKey: input.stripePublishableKey?.trim() || existing?.stripePublishableKey || '',
    stripeSecretKey: input.stripeSecretKey?.trim() || existing.stripeSecretKey || '',
    stripeWebhookSecret: input.stripeWebhookSecret?.trim() || existing?.stripeWebhookSecret || '',
    stripeWebhookSecretProd: input.stripeWebhookSecretProd?.trim() || existing?.stripeWebhookSecretProd || '',
    paypalClientId: input.paypalClientId?.trim() || existing?.paypalClientId || '',
    paypalClientSecret: input.paypalClientSecret?.trim() || existing?.paypalClientSecret || '',
    paypalEnv: input.paypalEnv === 'live' ? 'live' : 'sandbox',
    upsellProductId: input.upsellProductId?.trim() || existing?.upsellProductId || '',
    upsellVariantId: input.upsellVariantId?.trim() || existing?.upsellVariantId || '',
    checkoutZones: normalizeCheckoutZones(input.checkoutZones ?? existing?.checkoutZones),
    funnels: normalizeFunnelConfigs(input.funnels ?? existing?.funnels, {
      variantId: input.upsellVariantId?.trim() || existing?.upsellVariantId,
      productId: input.upsellProductId?.trim() || existing?.upsellProductId,
    }),
    standardShipping: numberSetting(input.standardShipping ?? existing?.standardShipping, 3.99),
    expressShipping: numberSetting(input.expressShipping ?? existing?.expressShipping, 5.99),
    taxRate: numberSetting(input.taxRate ?? existing?.taxRate, 0, 0, 1),
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
  });
}

export async function updateStoreRoutingConfig(input: {
  storeId: string;
  checkoutZones?: unknown;
  funnels?: unknown;
}) {
  return withConfigWriteLock(async () => {
    const configs = await readConfigFile();
    const index = configs.findIndex((item) => item.id === slug(input.storeId) || item.shopDomain === normalizeDomain(input.storeId));
    if (index < 0) throw new StoreConfigResolutionError('Unknown store configuration');
    const current = configs[index];
    const updated: StoreConfig = {
      ...current,
      checkoutZones: normalizeCheckoutZones(input.checkoutZones ?? current.checkoutZones),
      funnels: normalizeFunnelConfigs(input.funnels ?? current.funnels, {
        variantId: current.upsellVariantId,
        productId: current.upsellProductId,
      }),
      updatedAt: new Date().toISOString(),
    };
    configs[index] = updated;
    await writeConfigFile(configs);
    return updated;
  });
}

export async function saveShopifyInstallation(input: {
  shopDomain: string;
  accessToken: string;
  scopes?: string;
  name?: string;
  currency?: string;
}) {
  const shopDomain = normalizeDomain(input.shopDomain);
  if (!shopDomain || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.myshopify\.com$/i.test(shopDomain)) {
    throw new Error('A valid myshopify.com shop domain is required');
  }
  if (!input.accessToken) throw new Error('Shopify access token is required');
  return withConfigWriteLock(async () => {
    const configs = await readConfigFile();
    const now = new Date().toISOString();
    const index = configs.findIndex((config) => config.shopDomain === shopDomain);
    const existing = index >= 0 ? configs[index] : undefined;
    const config: StoreConfig = {
      id: existing?.id || shopDomain,
      name: input.name?.trim() || existing?.name || shopDomain,
      shopDomain,
      currency: normalizeCurrency(input.currency || existing?.currency),
      storefrontAccessToken: existing?.storefrontAccessToken || '',
      shopifyAdminAccessToken: input.accessToken,
      shopifyAppProxySecret: process.env.SHOPIFY_APP_PROXY_SECRET || shopifyClientSecrets()[0] || existing?.shopifyAppProxySecret || '',
      shopifyScopes: input.scopes?.trim() || existing?.shopifyScopes || '',
      orderMode: existing?.orderMode || 'draft_order',
      stripePublishableKey: existing?.stripePublishableKey || '',
      stripeSecretKey: existing?.stripeSecretKey || '',
      stripeWebhookSecret: existing?.stripeWebhookSecret || '',
      stripeWebhookSecretProd: existing?.stripeWebhookSecretProd || '',
      paypalClientId: existing?.paypalClientId || '',
      paypalClientSecret: existing?.paypalClientSecret || '',
      paypalEnv: existing?.paypalEnv || 'sandbox',
      upsellProductId: existing?.upsellProductId || '',
      upsellVariantId: existing?.upsellVariantId || '',
      checkoutZones: existing?.checkoutZones || [],
      funnels: existing?.funnels || [],
      standardShipping: existing?.standardShipping ?? 3.99,
      expressShipping: existing?.expressShipping ?? 5.99,
      taxRate: existing?.taxRate ?? 0,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    if (index >= 0) configs[index] = config;
    else configs.push(config);
    await writeConfigFile(configs);
    return config;
  });
}

/**
 * Keep merchant-defined checkout rules on uninstall, but remove every
 * credential that could continue to access the former shop. A later OAuth
 * install repopulates these fields for the same store domain.
 */
export async function revokeShopifyInstallation(shopDomain: string) {
  return withConfigWriteLock(async () => {
    const configs = await readConfigFile();
    const normalizedDomain = normalizeDomain(shopDomain);
    const index = configs.findIndex((config) => config.shopDomain === normalizedDomain);
    if (index < 0) return false;

    const current = configs[index];
    configs[index] = {
      ...current,
      storefrontAccessToken: '',
      shopifyAdminAccessToken: '',
      shopifyAppProxySecret: '',
      shopifyScopes: '',
      updatedAt: new Date().toISOString(),
    };
    await writeConfigFile(configs);
    return true;
  });
}

export async function deleteStoreConfig(id: string) {
  return withConfigWriteLock(async () => {
    const configs = await readConfigFile();
    const normalized = slug(id);
    const normalizedDomain = normalizeDomain(id);
    await writeConfigFile(configs.filter((item) => item.id !== normalized && item.shopDomain !== normalizedDomain));
  });
}
