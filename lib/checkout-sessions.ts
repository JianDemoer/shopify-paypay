import { mkdir, readFile, writeFile } from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import { normalizeUtm } from './checkout-pricing';
import { isProductionRuntime } from './runtime';
import type { CheckoutMode } from './funnel-configs';
import { upstashRestConfig } from './upstash-config';

export interface CheckoutLineItem {
  id: string;
  variantId: string;
  productId?: string;
  title: string;
  quantity: number;
  price: number;
  image?: string;
}

export interface CheckoutCustomer {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  address1: string;
  address2?: string;
  city: string;
  province?: string;
  country: string;
  zip: string;
}

export interface UpsellState {
  offerId: string;
  stepId?: string;
  item?: CheckoutLineItem;
  paymentId?: string;
  paymentStatus?: 'pending' | 'paid' | 'failed';
  draftOrderId?: string;
  orderId?: string;
  orderNumber?: number;
  decision?: 'accepted' | 'declined' | 'skipped';
}

export interface CheckoutSession {
  id: string;
  storeId: string;
  shopDomain: string;
  cid: string;
  currency: string;
  items: CheckoutLineItem[];
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  utm?: Record<string, string>;
  zoneId?: string;
  funnelId?: string;
  routeId?: string;
  funnelVersionId?: string;
  checkoutMode?: CheckoutMode;
  assignmentBucket?: number;
  currentStepId?: string;
  completedStepIds?: string[];
  funnelVariantId?: string;
  upsellOfferIds?: string[];
  upsellStates?: Record<string, UpsellState>;
  customer?: CheckoutCustomer;
  primaryPaymentId?: string;
  primaryPaymentStatus?: 'pending' | 'paid' | 'failed';
  primaryPaymentMethod?: 'stripe' | 'paypal';
  stripeCustomerId?: string;
  stripePaymentMethodId?: string;
  primaryShippingMethod?: 'standard' | 'express';
  primaryDraftOrderId?: string;
  primaryOrderId?: string;
  primaryOrderNumber?: number;
  paypalOrderId?: string;
  paypalOrderIds?: Record<string, string>;
  upsellItem?: CheckoutLineItem;
  upsellPaymentId?: string;
  upsellPaymentStatus?: 'pending' | 'paid' | 'failed';
  upsellDraftOrderId?: string;
  upsellOrderId?: string;
  upsellOrderNumber?: number;
  finalizationStatus?: 'pending' | 'processing' | 'completed' | 'failed';
  finalizeAfter?: string;
  finalizedAt?: string;
  createdAt: string;
  expiresAt: string;
  accessExpiresAt?: string;
}

type SessionStore = Map<string, CheckoutSession>;

const globalForCheckout = globalThis as typeof globalThis & {
  __checkoutSessions?: SessionStore;
  __checkoutLocks?: Set<string>;
  __checkoutLockTokens?: Map<string, string>;
};

const sessions = globalForCheckout.__checkoutSessions ?? new Map<string, CheckoutSession>();
globalForCheckout.__checkoutSessions = sessions;
const locks = globalForCheckout.__checkoutLocks ?? new Set<string>();
globalForCheckout.__checkoutLocks = locks;
const lockTokens = globalForCheckout.__checkoutLockTokens ?? new Map<string, string>();
globalForCheckout.__checkoutLockTokens = lockTokens;

const DATA_DIR = process.env.CHECKOUT_SESSION_DATA_DIR || path.join(process.cwd(), '.data');
const FILE_STORE_PATH = path.join(DATA_DIR, 'checkout-sessions.json');
const { url: UPSTASH_URL, token: UPSTASH_TOKEN } = upstashRestConfig();
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const CHECKOUT_ACCESS_TTL_SECONDS = 2 * 60 * 60;

function makeId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(8).toString('hex')}`;
}

export function normalizeCheckoutCid(value: unknown) {
  return String(value || '').trim().slice(0, 200) || makeId('cid');
}

function requireProductionStore() {
  if (isProductionRuntime() && (!UPSTASH_URL || !UPSTASH_TOKEN)) {
    throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required in production');
  }
}

function normalizeItems(input: any): CheckoutLineItem[] {
  const rawItems = Array.isArray(input?.items)
    ? input.items
    : [{
        id: input?.variantId,
        productId: input?.productId,
        variantId: input?.variantId,
        title: input?.title,
        quantity: input?.quantity,
        price: input?.price,
        image: input?.image,
      }];

  if (rawItems.length === 0 || rawItems.length > 50) {
    throw new Error('Checkout must contain between 1 and 50 items');
  }

  return rawItems.map((item: any, index: number) => {
    const quantity = Number(item.quantity);
    const price = Number(item.price);
    const variantId = String(item.variantId || '');
    const title = String(item.title || '').trim();
    if (!variantId || !title || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new Error(`Invalid checkout line item at index ${index}`);
    }
    if (!Number.isFinite(price) || price < 0 || price > 100000) {
      throw new Error(`Invalid checkout line item price at index ${index}`);
    }
    return {
      id: String(item.id || variantId),
      productId: item.productId ? String(item.productId) : undefined,
      variantId,
      title,
      quantity,
      price: Number(price.toFixed(2)),
      image: item.image ? String(item.image) : undefined,
    };
  });
}

async function upstashCommand(command: unknown[]) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;

  const response = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });

  if (!response.ok) {
    throw new Error(`Upstash Redis error: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function readFileStore() {
  requireProductionStore();
  try {
    const raw = await readFile(FILE_STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, CheckoutSession>;
    for (const [id, session] of Object.entries(parsed)) {
      sessions.set(id, session);
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function writeFileStore() {
  requireProductionStore();
  await mkdir(DATA_DIR, { recursive: true });
  const activeSessions = Object.fromEntries(
    [...sessions.entries()].filter(([, session]) => new Date(session.expiresAt).getTime() >= Date.now())
  );
  await writeFile(FILE_STORE_PATH, JSON.stringify(activeSessions, null, 2));
}

async function persistSession(session: CheckoutSession) {
  sessions.set(session.id, session);

  if (UPSTASH_URL && UPSTASH_TOKEN) {
    const expiresIn = Math.max(60, Math.ceil((new Date(session.expiresAt).getTime() - Date.now()) / 1000));
    await upstashCommand(['SET', `checkout_session:${session.id}`, JSON.stringify(session), 'EX', expiresIn]);
    return;
  }

  await writeFileStore();
}

export async function createCheckoutSession(input: any, resolvedItems?: CheckoutLineItem[]): Promise<CheckoutSession> {
  // Re-validate resolved items before persisting them so callers cannot bypass
  // quantity, title, or price bounds by supplying a pre-resolved array.
  const items = normalizeItems(resolvedItems ? { items: resolvedItems } : input);
  if (!items.length) throw new Error('Checkout must contain at least one item');
  const subtotal = Number(items.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2));
  const shipping = Number(Number(input?.shipping ?? 0).toFixed(2));
  const tax = Number(Number(input?.tax ?? 0).toFixed(2));
  if (!Number.isFinite(shipping) || shipping < 0 || !Number.isFinite(tax) || tax < 0) {
    throw new Error('Invalid checkout totals');
  }
  const total = Number((subtotal + shipping + tax).toFixed(2));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  const accessExpiresAt = new Date(now.getTime() + CHECKOUT_ACCESS_TTL_SECONDS * 1000);
  const cid = normalizeCheckoutCid(input?.cid);
  const currency = String(input?.currency || 'USD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid checkout currency');

  const session: CheckoutSession = {
    id: makeId('opc'),
    storeId: String(input?.storeId || ''),
    shopDomain: String(input?.shopDomain || input?.shop || ''),
    cid,
    currency,
    items,
    subtotal,
    shipping,
    tax,
    total,
    utm: normalizeUtm(input?.utm),
    zoneId: input?.funnelSelection?.zoneId ? String(input.funnelSelection.zoneId) : undefined,
    funnelId: input?.funnelSelection?.funnelId ? String(input.funnelSelection.funnelId) : undefined,
    routeId: input?.funnelSelection?.routeId ? String(input.funnelSelection.routeId) : undefined,
    funnelVersionId: input?.funnelSelection?.funnelVersionId ? String(input.funnelSelection.funnelVersionId) : undefined,
    checkoutMode: input?.funnelSelection?.checkoutMode,
    assignmentBucket: Number.isInteger(input?.funnelSelection?.assignmentBucket)
      ? input.funnelSelection.assignmentBucket
      : undefined,
    currentStepId: input?.funnelSelection?.currentStepId ? String(input.funnelSelection.currentStepId) : undefined,
    completedStepIds: [],
    funnelVariantId: input?.funnelSelection?.routeId ? String(input.funnelSelection.routeId) : undefined,
    upsellOfferIds: Array.isArray(input?.funnelSelection?.upsellOfferIds)
      ? input.funnelSelection.upsellOfferIds.map((id: unknown) => String(id)).slice(0, 20)
      : [],
    upsellStates: {},
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    accessExpiresAt: accessExpiresAt.toISOString(),
  };

  await persistSession(session);
  return session;
}

export async function getCheckoutSession(id: string): Promise<CheckoutSession | null> {
  requireProductionStore();
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    const response = await upstashCommand(['GET', `checkout_session:${id}`]);
    const raw = response?.result;
    if (!raw) return null;
    const session = JSON.parse(raw) as CheckoutSession;
    if (new Date(session.expiresAt).getTime() < Date.now()) return null;
    sessions.set(session.id, session);
    return session;
  }

  if (!sessions.has(id)) {
    await readFileStore();
  }

  const session = sessions.get(id);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    sessions.delete(id);
    await writeFileStore();
    return null;
  }
  return session;
}

export async function listCheckoutSessions() {
  requireProductionStore();
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    const sessionsFromRedis: CheckoutSession[] = [];
    let cursor = '0';
    do {
      const scan = await upstashCommand(['SCAN', cursor, 'MATCH', 'checkout_session:*', 'COUNT', 100]);
      cursor = String(scan?.result?.[0] || '0');
      const keys = Array.isArray(scan?.result?.[1]) ? scan.result[1] as string[] : [];
      for (const key of keys) {
        const raw = (await upstashCommand(['GET', key]))?.result;
        if (!raw) continue;
        try {
          const session = JSON.parse(raw) as CheckoutSession;
          if (new Date(session.expiresAt).getTime() >= Date.now()) sessionsFromRedis.push(session);
        } catch {
          // Ignore malformed expired data; a future scan can clean it up.
        }
      }
    } while (cursor !== '0');
    return sessionsFromRedis;
  }
  await readFileStore();
  return [...sessions.values()].filter((session) => new Date(session.expiresAt).getTime() >= Date.now());
}

export async function updateCheckoutSession(
  id: string,
  patch: Partial<CheckoutSession>
): Promise<CheckoutSession> {
  const lockKey = `session-update:${id}`;
  let acquired = false;
  let lockToken = '';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const acquiredToken = await acquireCheckoutLock(lockKey, 30);
    if (acquiredToken) {
      acquired = true;
      lockToken = acquiredToken;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!acquired) throw new Error('Checkout session update is already in progress');

  try {
    const current = await getCheckoutSession(id);
    if (!current) throw new Error('Checkout session not found or expired');
    const updated = { ...current, ...patch };
    await persistSession(updated);
    return updated;
  } finally {
    await releaseCheckoutLock(lockKey, lockToken);
  }
}

export async function reservePrimaryPaymentMethod(
  id: string,
  method: 'stripe' | 'paypal'
) {
  const lockKey = `session-update:${id}`;
  let acquired = false;
  let lockToken = '';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const acquiredToken = await acquireCheckoutLock(lockKey, 30);
    if (acquiredToken) {
      acquired = true;
      lockToken = acquiredToken;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!acquired) throw new Error('Checkout session update is already in progress');

  try {
    const current = await getCheckoutSession(id);
    if (!current) throw new Error('Checkout session not found or expired');
    const existingMethod = current.primaryPaymentMethod
      || (current.paypalOrderId ? 'paypal' : current.primaryPaymentId ? 'stripe' : undefined);
    if (existingMethod && existingMethod !== method) return false;
    if (current.primaryPaymentMethod === method) return true;
    await persistSession({ ...current, primaryPaymentMethod: method });
    return true;
  } finally {
    await releaseCheckoutLock(lockKey, lockToken);
  }
}

export async function releasePrimaryPaymentMethodReservation(
  id: string,
  method: 'stripe' | 'paypal'
) {
  const lockKey = `session-update:${id}`;
  const lockToken = await acquireCheckoutLock(lockKey, 30);
  if (!lockToken) return false;

  try {
    const current = await getCheckoutSession(id);
    if (!current) return false;
    const inferredMethod = current.primaryPaymentMethod
      || (current.paypalOrderId ? 'paypal' : current.primaryPaymentId ? 'stripe' : undefined);
    if (
      inferredMethod !== method ||
      current.primaryPaymentId ||
      current.paypalOrderId ||
      current.primaryPaymentStatus === 'paid'
    ) return false;

    const updated = { ...current };
    delete updated.primaryPaymentMethod;
    delete updated.primaryShippingMethod;
    await persistSession(updated);
    return true;
  } finally {
    await releaseCheckoutLock(lockKey, lockToken);
  }
}

export async function clearFailedPrimaryPayment(id: string, paymentId: string) {
  const lockKey = `session-update:${id}`;
  const lockToken = await acquireCheckoutLock(lockKey, 30);
  if (!lockToken) return false;

  try {
    const current = await getCheckoutSession(id);
    if (!current || current.primaryPaymentId !== paymentId || current.primaryPaymentStatus !== 'failed') return false;
    const updated = { ...current };
    delete updated.primaryPaymentId;
    delete updated.primaryPaymentStatus;
    delete updated.primaryPaymentMethod;
    delete updated.primaryShippingMethod;
    await persistSession(updated);
    return true;
  } finally {
    await releaseCheckoutLock(lockKey, lockToken);
  }
}

export async function acquireCheckoutLock(key: string, ttlSeconds = 120): Promise<string | null> {
  const token = crypto.randomBytes(16).toString('hex');
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    const result = await upstashCommand(['SET', `checkout_lock:${key}`, token, 'NX', 'EX', ttlSeconds]);
    if (result?.result === 'OK') {
      lockTokens.set(key, token);
      return token;
    }
    return null;
  }
  if (locks.has(key)) return null;
  locks.add(key);
  lockTokens.set(key, token);
  return token;
}

export async function releaseCheckoutLock(key: string, token?: string) {
  if (!token) return;
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    await upstashCommand([
      'EVAL',
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      '1',
      `checkout_lock:${key}`,
      token,
    ]);
    if (lockTokens.get(key) === token) lockTokens.delete(key);
    return;
  }
  if (lockTokens.get(key) === token) {
    lockTokens.delete(key);
    locks.delete(key);
  }
}

export async function ensureCheckoutSession(id: string, cid = ''): Promise<CheckoutSession> {
  return await getCheckoutSession(id) ?? await createCheckoutSession({ cid });
}
