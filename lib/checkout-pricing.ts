import type { CheckoutCustomer, CheckoutLineItem } from './checkout-sessions';
import type { StoreConfig } from './store-configs';

export type ShippingMethod = 'standard' | 'express' | 'ships-with-original-order';

export function shippingFor(config: StoreConfig, method: string | undefined, purchaseKind: 'main' | 'upsell') {
  if (purchaseKind === 'upsell' || method === 'ships-with-original-order') return 0;
  if (method === 'express') return Number(config.expressShipping.toFixed(2));
  return Number(config.standardShipping.toFixed(2));
}

export function calculateTotals(
  items: CheckoutLineItem[],
  config: StoreConfig,
  method: string | undefined,
  purchaseKind: 'main' | 'upsell'
) {
  const subtotal = Number(items.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2));
  const shipping = shippingFor(config, method, purchaseKind);
  const tax = Number((subtotal * config.taxRate).toFixed(2));
  return {
    subtotal,
    shipping,
    tax,
    total: Number((subtotal + shipping + tax).toFixed(2)),
  };
}

function text(value: unknown, maxLength: number) {
  return String(value || '').trim().slice(0, maxLength);
}

export function parseCustomer(input: any, fallback?: CheckoutCustomer): CheckoutCustomer {
  const customer: CheckoutCustomer = {
    email: text(input?.email || fallback?.email, 254).toLowerCase(),
    firstName: text(input?.firstName || fallback?.firstName, 80),
    lastName: text(input?.lastName || fallback?.lastName, 80),
    phone: text(input?.phone || fallback?.phone, 40),
    address1: text(input?.address1 || fallback?.address1, 160),
    address2: text(input?.address2 || fallback?.address2, 160),
    city: text(input?.city || fallback?.city, 100),
    province: text(input?.province || fallback?.province, 100),
    country: text(input?.country || fallback?.country, 100),
    zip: text(input?.zip || fallback?.zip, 30),
  };

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) throw new Error('A valid email is required');
  if (!customer.firstName || !customer.lastName || !customer.address1 || !customer.city || !customer.country || !customer.zip) {
    throw new Error('Complete shipping information is required');
  }
  return customer;
}

export function normalizeUtm(input: unknown) {
  if (!input || typeof input !== 'object') return {};
  const source = input as Record<string, unknown>;
  return Object.fromEntries(
    ['source', 'campaign', 'medium', 'content', 'term']
      .map((key) => [key, text(source[key], 200)])
      .filter(([, value]) => value)
  );
}

export function normalizeSourceUrl(value: unknown) {
  const raw = text(value, 1000);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    for (const key of ['checkout_token', 'payment_intent_client_secret', 'client_secret']) {
      url.searchParams.delete(key);
    }
    return `${url.pathname}${url.search}`.slice(0, 500);
  } catch {
    return '';
  }
}
