import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

export interface CheckoutLineItem {
  id: string;
  variantId: string;
  productId?: string;
  title: string;
  quantity: number;
  price: number;
  image?: string;
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
  createdAt: string;
  expiresAt: string;
}

type SessionStore = Map<string, CheckoutSession>;

const globalForCheckout = globalThis as typeof globalThis & {
  __checkoutSessions?: SessionStore;
};

const sessions = globalForCheckout.__checkoutSessions ?? new Map<string, CheckoutSession>();
globalForCheckout.__checkoutSessions = sessions;

const DATA_DIR = process.env.CHECKOUT_SESSION_DATA_DIR || path.join(process.cwd(), '.data');
const FILE_STORE_PATH = path.join(DATA_DIR, 'checkout-sessions.json');
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const SESSION_TTL_SECONDS = 30 * 60;

const DEFAULT_ITEM: CheckoutLineItem = {
  id: 'demo-pen-4-pack',
  productId: 'gid://shopify/Product/demo',
  variantId: 'gid://shopify/ProductVariant/demo',
  title: 'Healrize 3D Relief Art Pen - 4 Pack',
  quantity: 1,
  price: 49.97,
};

function makeId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeItems(input: any): CheckoutLineItem[] {
  const rawItems = Array.isArray(input?.items) && input.items.length > 0
    ? input.items
    : [{
        id: input?.variantId || DEFAULT_ITEM.id,
        productId: input?.productId || DEFAULT_ITEM.productId,
        variantId: input?.variantId || DEFAULT_ITEM.variantId,
        title: input?.title || DEFAULT_ITEM.title,
        quantity: input?.quantity || DEFAULT_ITEM.quantity,
        price: input?.price || DEFAULT_ITEM.price,
        image: input?.image,
      }];

  return rawItems.map((item: any, index: number) => ({
    id: String(item.id || item.variantId || `line-${index}`),
    productId: item.productId ? String(item.productId) : undefined,
    variantId: String(item.variantId || DEFAULT_ITEM.variantId),
    title: String(item.title || DEFAULT_ITEM.title),
    quantity: Math.max(1, Number(item.quantity || 1)),
    price: Number(item.price || DEFAULT_ITEM.price),
    image: item.image ? String(item.image) : undefined,
  }));
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
  await mkdir(DATA_DIR, { recursive: true });
  const activeSessions = Object.fromEntries(
    [...sessions.entries()].filter(([, session]) => new Date(session.expiresAt).getTime() >= Date.now())
  );
  await writeFile(FILE_STORE_PATH, JSON.stringify(activeSessions, null, 2));
}

async function persistSession(session: CheckoutSession) {
  sessions.set(session.id, session);

  if (UPSTASH_URL && UPSTASH_TOKEN) {
    await upstashCommand(['SET', `checkout_session:${session.id}`, JSON.stringify(session), 'EX', SESSION_TTL_SECONDS]);
    return;
  }

  await writeFileStore();
}

export async function createCheckoutSession(input: any): Promise<CheckoutSession> {
  const items = normalizeItems(input);
  const subtotal = Number(items.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2));
  const shipping = Number((input?.shipping ?? 3.99).toFixed ? input.shipping.toFixed(2) : Number(input?.shipping ?? 3.99).toFixed(2));
  const tax = Number((input?.tax ?? 0).toFixed ? input.tax.toFixed(2) : Number(input?.tax ?? 0).toFixed(2));
  const total = Number((subtotal + shipping + tax).toFixed(2));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);

  const session: CheckoutSession = {
    id: makeId('opc'),
    storeId: String(input?.storeId || input?.shopDomain || input?.shop || 'default'),
    shopDomain: String(input?.shopDomain || input?.shop || ''),
    cid: String(input?.cid || makeId('cid')),
    currency: String(input?.currency || 'USD'),
    items,
    subtotal,
    shipping,
    tax,
    total,
    utm: input?.utm || {},
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  await persistSession(session);
  return session;
}

export async function getCheckoutSession(id: string): Promise<CheckoutSession | null> {
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

export async function ensureCheckoutSession(id: string, cid = ''): Promise<CheckoutSession> {
  return await getCheckoutSession(id) ?? await createCheckoutSession({ cid });
}
