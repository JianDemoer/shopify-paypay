import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { isProductionRuntime } from './runtime';
import { upstashRestConfig } from './upstash-config';

export type CheckoutEventType =
  | 'checkout_started'
  | 'contact_submitted'
  | 'payment_intent_created'
  | 'payment_succeeded'
  | 'funnel_step_viewed'
  | 'funnel_step_decision'
  | 'checkout_abandoned'
  | 'order_finalized';

export interface CheckoutEvent {
  id: string;
  type: CheckoutEventType;
  storeId: string;
  sessionId: string;
  cid?: string;
  funnelId?: string;
  routeId?: string;
  funnelVersionId?: string;
  stepId?: string;
  purchaseKind?: 'main' | 'upsell';
  value?: number;
  currency?: string;
  occurredAt: string;
  properties?: Record<string, string | number | boolean>;
}

const DATA_DIR = process.env.CHECKOUT_SESSION_DATA_DIR || path.join(process.cwd(), '.data');
const FILE_PATH = path.join(DATA_DIR, 'checkout-events.json');
const { url: REDIS_URL, token: REDIS_TOKEN } = upstashRestConfig();
const REDIS_KEY = 'omni_checkout:events';
const MAX_EVENTS = 100000;

function eventId() {
  return `evt_${Date.now().toString(36)}_${crypto.randomBytes(8).toString('hex')}`;
}

function cleanProperties(value: unknown) {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  const result: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(input).slice(0, 30)) {
    if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(key)) continue;
    if (typeof raw === 'string') result[key] = raw.slice(0, 300);
    else if (typeof raw === 'number' && Number.isFinite(raw)) result[key] = Number(raw.toFixed(2));
    else if (typeof raw === 'boolean') result[key] = raw;
  }
  return Object.keys(result).length ? result : undefined;
}

function normalizeEvent(input: Partial<CheckoutEvent>): CheckoutEvent {
  const allowed: CheckoutEventType[] = [
    'checkout_started', 'contact_submitted', 'payment_intent_created', 'payment_succeeded',
    'funnel_step_viewed', 'funnel_step_decision', 'checkout_abandoned', 'order_finalized',
  ];
  if (!input.storeId || !input.sessionId || !input.type || !allowed.includes(input.type)) throw new Error('Invalid checkout event');
  return {
    id: input.id || eventId(),
    type: input.type,
    storeId: String(input.storeId).slice(0, 120),
    sessionId: String(input.sessionId).slice(0, 160),
    cid: input.cid ? String(input.cid).slice(0, 200) : undefined,
    funnelId: input.funnelId ? String(input.funnelId).slice(0, 80) : undefined,
    routeId: input.routeId ? String(input.routeId).slice(0, 80) : undefined,
    funnelVersionId: input.funnelVersionId ? String(input.funnelVersionId).slice(0, 80) : undefined,
    stepId: input.stepId ? String(input.stepId).slice(0, 80) : undefined,
    purchaseKind: input.purchaseKind === 'upsell' ? 'upsell' : input.purchaseKind === 'main' ? 'main' : undefined,
    value: typeof input.value === 'number' && Number.isFinite(input.value) ? Number(input.value.toFixed(2)) : undefined,
    currency: input.currency ? String(input.currency).slice(0, 3).toUpperCase() : undefined,
    occurredAt: input.occurredAt || new Date().toISOString(),
    properties: cleanProperties(input.properties),
  };
}

async function redisCommand(command: unknown[]) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  const response = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error(`Event store error: ${response.status}`);
  return response.json();
}

async function localEvents() {
  try {
    return JSON.parse(await readFile(FILE_PATH, 'utf8')) as CheckoutEvent[];
  } catch (error: any) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

export async function recordCheckoutEvent(input: Partial<CheckoutEvent>) {
  const event = normalizeEvent(input);
  if (REDIS_URL && REDIS_TOKEN) {
    await redisCommand(['LPUSH', REDIS_KEY, JSON.stringify(event)]);
    await redisCommand(['LTRIM', REDIS_KEY, 0, MAX_EVENTS - 1]);
    return event;
  }
  if (isProductionRuntime()) throw new Error('Persistent event storage is required in production');
  const events = await localEvents();
  events.unshift(event);
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(FILE_PATH, JSON.stringify(events.slice(0, MAX_EVENTS), null, 2), { mode: 0o600 });
  return event;
}

export async function listCheckoutEvents(input: { storeId?: string; from?: Date; to?: Date } = {}) {
  let events: CheckoutEvent[];
  if (REDIS_URL && REDIS_TOKEN) {
    const result = await redisCommand(['LRANGE', REDIS_KEY, 0, MAX_EVENTS - 1]);
    events = (result?.result || []).flatMap((raw: string) => {
      try { return [JSON.parse(raw) as CheckoutEvent]; } catch { return []; }
    });
  } else {
    events = await localEvents();
  }
  return events.filter((event) => {
    const time = new Date(event.occurredAt).getTime();
    return (!input.storeId || event.storeId === input.storeId)
      && (!input.from || time >= input.from.getTime())
      && (!input.to || time <= input.to.getTime());
  });
}

export function summarizeCheckoutEvents(events: CheckoutEvent[]) {
  const sessions = new Set(events.map((event) => event.sessionId));
  const started = new Set(events.filter((event) => event.type === 'checkout_started').map((event) => event.sessionId));
  const mainPaid = new Set(events.filter((event) => event.type === 'payment_succeeded' && event.purchaseKind !== 'upsell').map((event) => event.sessionId));
  const finalized = new Set(events.filter((event) => event.type === 'order_finalized').map((event) => event.sessionId));
  const upsellPaid = events.filter((event) => event.type === 'payment_succeeded' && event.purchaseKind === 'upsell');
  const finalizedRevenue = new Map(events
    .filter((event) => event.type === 'order_finalized')
    .map((event) => [event.sessionId, event.value || 0] as const));
  const revenue = events
    .filter((event) => event.type === 'payment_succeeded' && !finalizedRevenue.has(event.sessionId))
    .reduce((sum, event) => sum + (event.value || 0), 0)
    + [...finalizedRevenue.values()].reduce((sum, value) => sum + value, 0);
  const upsellRevenue = upsellPaid.reduce((sum, event) => sum + (event.value || 0), 0);
  return {
    sessions: sessions.size,
    checkoutStarted: started.size,
    orders: finalized.size,
    orderConversionRate: started.size ? finalized.size / started.size : 0,
    mainPaid: mainPaid.size,
    revenue: Number(revenue.toFixed(2)),
    upsellOrders: new Set(upsellPaid.map((event) => event.sessionId)).size,
    upsellRevenue: Number(upsellRevenue.toFixed(2)),
    upsellConversionRate: mainPaid.size ? new Set(upsellPaid.map((event) => event.sessionId)).size / mainPaid.size : 0,
  };
}
