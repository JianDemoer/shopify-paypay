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

export function createCheckoutSession(input: any): CheckoutSession {
  const items = normalizeItems(input);
  const subtotal = Number(items.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2));
  const shipping = Number((input?.shipping ?? 3.99).toFixed ? input.shipping.toFixed(2) : Number(input?.shipping ?? 3.99).toFixed(2));
  const tax = Number((input?.tax ?? 0).toFixed ? input.tax.toFixed(2) : Number(input?.tax ?? 0).toFixed(2));
  const total = Number((subtotal + shipping + tax).toFixed(2));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);

  const session: CheckoutSession = {
    id: makeId('opc'),
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

  sessions.set(session.id, session);
  return session;
}

export function getCheckoutSession(id: string): CheckoutSession | null {
  const session = sessions.get(id);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    sessions.delete(id);
    return null;
  }
  return session;
}

export function ensureCheckoutSession(id: string, cid = ''): CheckoutSession {
  return getCheckoutSession(id) ?? createCheckoutSession({ cid });
}
