import type { CheckoutLineItem } from './checkout-sessions';

export type CheckoutMode = 'one_page' | 'three_step' | 'paypal_direct' | 'shopify';
export type FunnelStepType = 'checkout' | 'upsell' | 'downsell' | 'thank_you';
export type FunnelVersionStatus = 'draft' | 'published' | 'archived';

export interface CheckoutZoneRoute {
  id: string;
  name: string;
  enabled: boolean;
  funnelId: string;
  funnelVersionId?: string;
  weight: number;
  mode: CheckoutMode;
}

export interface CheckoutZone {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  countries: string[];
  currencies: string[];
  utmSources: string[];
  routes: CheckoutZoneRoute[];
}

export interface FunnelTriggerRule {
  field: 'product_id' | 'variant_id' | 'country' | 'utm_source' | 'cart_total';
  operator: 'includes' | 'excludes' | 'equals' | 'greater_than';
  values: string[];
}

export interface FunnelOffer {
  variantId: string;
  productId?: string;
  quantity: number;
  title?: string;
  description?: string;
  image?: string;
  priceOverride?: number;
  acceptLabel?: string;
  declineLabel?: string;
}

export interface FunnelStepSettings {
  headline?: string;
  body?: string;
  countdownMinutes?: number;
}

export interface FunnelStep {
  id: string;
  type: FunnelStepType;
  name: string;
  enabled: boolean;
  acceptNextStepId?: string;
  declineNextStepId?: string;
  triggerRules: FunnelTriggerRule[];
  offer?: FunnelOffer;
  settings?: FunnelStepSettings;
}

export interface FunnelVersion {
  id: string;
  version: number;
  status: FunnelVersionStatus;
  entryStepId: string;
  steps: FunnelStep[];
  createdAt?: string;
  publishedAt?: string;
}

export interface FunnelConfig {
  id: string;
  name: string;
  enabled: boolean;
  publishedVersionId: string;
  versions: FunnelVersion[];
}

export interface FunnelSelection {
  zoneId: string;
  routeId: string;
  funnelId: string;
  funnelVersionId: string;
  checkoutMode: CheckoutMode;
  assignmentBucket: number;
  entryStepId: string;
  currentStepId: string;
}

export interface FunnelContext {
  items?: CheckoutLineItem[];
  country?: string;
  utmSource?: string;
  cartTotal?: number;
}

export const DEFAULT_FUNNEL_ID = 'default-funnel';
export const DEFAULT_FUNNEL_VERSION_ID = 'default-v1';
export const DEFAULT_ROUTE_ID = 'default-route';

function stringValue(value: unknown, maxLength: number) {
  return String(value || '').trim().slice(0, maxLength);
}

function idValue(value: unknown, fallback: string) {
  return stringValue(value, 80).toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || fallback;
}

function stringList(value: unknown, maxItems = 50) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => stringValue(item, 120).toLowerCase())
    .filter(Boolean))]
    .slice(0, maxItems);
}

function numberValue(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Number(parsed.toFixed(2))));
}

function boolValue(value: unknown, fallback = true) {
  return typeof value === 'boolean' ? value : fallback;
}

function checkoutMode(value: unknown): CheckoutMode {
  return value === 'one_page' || value === 'paypal_direct' || value === 'shopify'
    ? value
    : 'three_step';
}

function stepType(value: unknown): FunnelStepType {
  return value === 'upsell' || value === 'downsell' || value === 'thank_you'
    ? value
    : 'checkout';
}

function versionStatus(value: unknown): FunnelVersionStatus {
  return value === 'published' || value === 'archived' ? value : 'draft';
}

function normalizeOffer(value: unknown): FunnelOffer | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  const variantId = stringValue(input.variantId, 160);
  if (!variantId) return undefined;
  const hasPriceOverride = input.priceOverride !== undefined && input.priceOverride !== '';
  return {
    variantId,
    productId: stringValue(input.productId, 160) || undefined,
    quantity: numberValue(input.quantity, 1, 1, 100),
    title: stringValue(input.title, 180) || undefined,
    description: stringValue(input.description, 1000) || undefined,
    image: stringValue(input.image, 1000) || undefined,
    priceOverride: hasPriceOverride ? numberValue(input.priceOverride, 0, 0, 100000) : undefined,
    acceptLabel: stringValue(input.acceptLabel, 160) || undefined,
    declineLabel: stringValue(input.declineLabel, 160) || undefined,
  };
}

function normalizeTriggerRules(value: unknown): FunnelTriggerRule[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const input = raw as Record<string, unknown>;
    const field = input.field;
    const operator = input.operator;
    if (
      field !== 'product_id' && field !== 'variant_id' && field !== 'country'
      && field !== 'utm_source' && field !== 'cart_total'
    ) return [];
    if (operator !== 'includes' && operator !== 'excludes' && operator !== 'equals' && operator !== 'greater_than') {
      return [];
    }
    const values = stringList(input.values, 50);
    if (!values.length) return [];
    return [{ field, operator, values } as FunnelTriggerRule];
  });
}

function normalizeSteps(value: unknown, versionId: string): FunnelStep[] {
  if (!Array.isArray(value)) return [];
  const usedIds = new Set<string>();
  return value.slice(0, 100).flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object') return [];
    const input = raw as Record<string, unknown>;
    const type = stepType(input.type);
    let id = idValue(input.id, `${versionId}-step-${index + 1}`);
    if (usedIds.has(id)) id = `${id}-${index + 1}`;
    usedIds.add(id);
    const offer = type === 'upsell' || type === 'downsell' ? normalizeOffer(input.offer || input) : undefined;
    if ((type === 'upsell' || type === 'downsell') && !offer) return [];
    const settingsInput = input.settings && typeof input.settings === 'object'
      ? input.settings as Record<string, unknown>
      : {};
    return [{
      id,
      type,
      name: stringValue(input.name, 160) || `${type.replace('_', ' ')} ${index + 1}`,
      enabled: boolValue(input.enabled),
      acceptNextStepId: stringValue(input.acceptNextStepId, 80) || undefined,
      declineNextStepId: stringValue(input.declineNextStepId, 80) || undefined,
      triggerRules: normalizeTriggerRules(input.triggerRules),
      offer,
      settings: {
        headline: stringValue(settingsInput.headline, 240) || undefined,
        body: stringValue(settingsInput.body, 1500) || undefined,
        countdownMinutes: settingsInput.countdownMinutes === undefined
          ? undefined
          : numberValue(settingsInput.countdownMinutes, 0, 0, 1440),
      },
    }];
  });
}

function legacyVersion(input: Record<string, unknown>, funnelId: string): FunnelVersion {
  const checkoutId = `${funnelId}-checkout`;
  const thankYouId = `${funnelId}-thank-you`;
  const legacyOffers = Array.isArray(input.upsells) ? input.upsells : [];
  const offers = legacyOffers.slice(0, 20).flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object') return [];
    const offerInput = raw as Record<string, unknown>;
    if (!boolValue(offerInput.enabled)) return [];
    const offer = normalizeOffer(offerInput);
    if (!offer) return [];
    return [{
      id: idValue(offerInput.id, `${funnelId}-upsell-${index + 1}`),
      type: 'upsell' as const,
      name: stringValue(offerInput.name, 160) || `Upsell ${index + 1}`,
      enabled: true,
      triggerRules: [],
      offer,
    }];
  });
  const steps: FunnelStep[] = [
    {
      id: checkoutId,
      type: 'checkout',
      name: 'Checkout',
      enabled: true,
      triggerRules: [],
      acceptNextStepId: offers[0]?.id || thankYouId,
      declineNextStepId: offers[0]?.id || thankYouId,
    },
    ...offers.map((offer, index) => ({
      ...offer,
      acceptNextStepId: offers[index + 1]?.id || thankYouId,
      declineNextStepId: offers[index + 1]?.id || thankYouId,
    })),
    {
      id: thankYouId,
      type: 'thank_you',
      name: 'Thank you',
      enabled: true,
      triggerRules: [],
    },
  ];
  return {
    id: `${funnelId}-v1`,
    version: 1,
    status: 'published',
    entryStepId: checkoutId,
    steps,
  };
}

export function createLegacyDefaultFunnel(variantId?: string, productId?: string): FunnelConfig {
  const input: Record<string, unknown> = {};
  if (variantId) {
    input.upsells = [{
      id: 'default-upsell',
      name: 'Default upsell',
      enabled: true,
      variantId,
      productId,
    }];
  }
  const version = legacyVersion(input, DEFAULT_FUNNEL_ID);
  return {
    id: DEFAULT_FUNNEL_ID,
    name: 'Default funnel',
    enabled: true,
    publishedVersionId: version.id,
    versions: [version],
  };
}

export function normalizeFunnelConfigs(value: unknown, legacyUpsell?: { variantId?: string; productId?: string }): FunnelConfig[] {
  if (!Array.isArray(value) || value.length === 0) {
    return legacyUpsell?.variantId
      ? [createLegacyDefaultFunnel(legacyUpsell.variantId, legacyUpsell.productId)]
      : [];
  }
  const usedIds = new Set<string>();
  return value.slice(0, 100).flatMap((raw, funnelIndex) => {
    if (!raw || typeof raw !== 'object') return [];
    const input = raw as Record<string, unknown>;
    let id = idValue(input.id, `funnel-${funnelIndex + 1}`);
    if (usedIds.has(id)) id = `${id}-${funnelIndex + 1}`;
    usedIds.add(id);
    const rawVersions = Array.isArray(input.versions) ? input.versions : [];
    const versions = rawVersions.length
      ? rawVersions.slice(0, 50).flatMap((rawVersion, versionIndex) => {
          if (!rawVersion || typeof rawVersion !== 'object') return [];
          const versionInput = rawVersion as Record<string, unknown>;
          const versionId = idValue(versionInput.id, `${id}-v${versionIndex + 1}`);
          const steps = normalizeSteps(versionInput.steps, versionId);
          if (!steps.length) return [];
          const stepIds = new Set(steps.map((step) => step.id));
          const firstCheckout = steps.find((step) => step.enabled && step.type === 'checkout') || steps.find((step) => step.enabled);
          if (!firstCheckout) return [];
          const entryStepId = stepIds.has(String(versionInput.entryStepId))
            ? String(versionInput.entryStepId)
            : firstCheckout.id;
          return [{
            id: versionId,
            version: numberValue(versionInput.version, versionIndex + 1, 1, 100000),
            status: versionStatus(versionInput.status),
            entryStepId,
            steps,
            createdAt: stringValue(versionInput.createdAt, 40) || undefined,
            publishedAt: stringValue(versionInput.publishedAt, 40) || undefined,
          } as FunnelVersion];
        })
      : [legacyVersion(input, id)];
    if (!versions.length) return [];
    const requestedPublishedId = stringValue(input.publishedVersionId, 80);
    const published = versions.find((version) => version.id === requestedPublishedId && version.status === 'published')
      || versions.filter((version) => version.status === 'published').sort((a, b) => b.version - a.version)[0]
      || versions.sort((a, b) => b.version - a.version)[0];
    return [{
      id,
      name: stringValue(input.name, 160) || id,
      enabled: boolValue(input.enabled),
      publishedVersionId: published.id,
      versions,
    }];
  });
}

export function normalizeCheckoutZones(value: unknown): CheckoutZone[] {
  if (!Array.isArray(value)) return [];
  const usedIds = new Set<string>();
  return value.slice(0, 100).flatMap((raw, zoneIndex) => {
    if (!raw || typeof raw !== 'object') return [];
    const input = raw as Record<string, unknown>;
    let id = idValue(input.id, `zone-${zoneIndex + 1}`);
    if (usedIds.has(id)) id = `${id}-${zoneIndex + 1}`;
    usedIds.add(id);
    const rawRoutes = Array.isArray(input.routes)
      ? input.routes
      : [{
          id: `${id}-route`,
          name: stringValue(input.name, 120) || 'Default route',
          funnelId: input.funnelId || DEFAULT_FUNNEL_ID,
          funnelVersionId: input.funnelVersionId,
          weight: 100,
          mode: input.mode,
        }];
    const routeIds = new Set<string>();
    const routes = rawRoutes.slice(0, 50).flatMap((rawRoute, routeIndex) => {
      if (!rawRoute || typeof rawRoute !== 'object') return [];
      const route = rawRoute as Record<string, unknown>;
      let routeId = idValue(route.id, `${id}-route-${routeIndex + 1}`);
      if (routeIds.has(routeId)) routeId = `${routeId}-${routeIndex + 1}`;
      routeIds.add(routeId);
      return [{
        id: routeId,
        name: stringValue(route.name, 160) || `Route ${routeIndex + 1}`,
        enabled: boolValue(route.enabled),
        funnelId: idValue(route.funnelId, DEFAULT_FUNNEL_ID),
        funnelVersionId: stringValue(route.funnelVersionId, 80) || undefined,
        weight: numberValue(route.weight, routeIndex === 0 ? 100 : 0, 0, 100000),
        mode: checkoutMode(route.mode),
      }];
    });
    return [{
      id,
      name: stringValue(input.name, 160) || `Zone ${zoneIndex + 1}`,
      enabled: boolValue(input.enabled),
      priority: numberValue(input.priority, 0, -1000, 1000),
      countries: stringList(input.countries),
      currencies: stringList(input.currencies),
      utmSources: stringList(input.utmSources),
      routes,
    }];
  });
}

export function stableAssignmentBucket(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 10000;
}

function matchesRule(values: string[], actual: string) {
  return values.length === 0 || values.includes('*') || values.includes(actual.toLowerCase());
}

function getPublishedVersion(funnel: FunnelConfig, requestedVersionId?: string) {
  return funnel.versions.find((version) => version.id === requestedVersionId && version.status === 'published')
    || funnel.versions.find((version) => version.id === funnel.publishedVersionId && version.status === 'published')
    || funnel.versions.filter((version) => version.status === 'published').sort((a, b) => b.version - a.version)[0];
}

export function selectFunnel(input: {
  zones?: CheckoutZone[];
  funnels?: FunnelConfig[];
  cid: string;
  country?: string;
  currency?: string;
  utmSource?: string;
  permalinkRouteId?: string;
}): FunnelSelection {
  const normalizedFunnels = normalizeFunnelConfigs(input.funnels || []).filter((funnel) => funnel.enabled);
  const funnels = normalizedFunnels.length ? normalizedFunnels : [createLegacyDefaultFunnel()];
  const funnelMap = new Map(funnels.map((funnel) => [funnel.id, funnel]));
  const zones = normalizeCheckoutZones(input.zones || []).filter((zone) => zone.enabled);
  const country = stringValue(input.country, 80).toLowerCase();
  const currency = stringValue(input.currency, 3).toLowerCase();
  const utmSource = stringValue(input.utmSource, 120).toLowerCase();

  let zone: CheckoutZone | undefined;
  let permalinkRoute: CheckoutZoneRoute | undefined;
  const permalinkRouteId = idValue(input.permalinkRouteId, '');
  if (permalinkRouteId) {
    for (const candidate of zones) {
      const route = candidate.routes.find((item) => item.id === permalinkRouteId && item.enabled);
      if (route) {
        zone = candidate;
        permalinkRoute = route;
        break;
      }
    }
  }
  if (!zone) {
    zone = zones
      .filter((item) => matchesRule(item.countries, country))
      .filter((item) => matchesRule(item.currencies, currency))
      .filter((item) => matchesRule(item.utmSources, utmSource))
      .filter((item) => item.routes.some((route) => route.enabled && route.weight > 0 && funnelMap.has(route.funnelId)))
      .sort((left, right) => right.priority - left.priority)[0];
  }

  const fallbackFunnel = funnels[0];
  const routes = permalinkRoute
    ? [permalinkRoute]
    : (zone?.routes || []).filter((route) => route.enabled && route.weight > 0 && funnelMap.has(route.funnelId));
  const totalWeight = routes.reduce((sum, route) => sum + route.weight, 0);
  const assignmentBucket = stableAssignmentBucket(`${input.cid}:${zone?.id || 'default-zone'}`);
  const target = totalWeight > 0 ? (assignmentBucket / 10000) * totalWeight : 0;
  let cursor = 0;
  const route = routes.find((candidate) => {
    cursor += candidate.weight;
    return target < cursor;
  }) || routes[0] || {
    id: DEFAULT_ROUTE_ID,
    name: 'Default route',
    enabled: true,
    funnelId: fallbackFunnel.id,
    weight: 100,
    mode: 'three_step' as const,
  };
  const funnel = funnelMap.get(route.funnelId) || fallbackFunnel;
  const version = getPublishedVersion(funnel, route.funnelVersionId);
  if (!version) throw new Error(`Funnel ${funnel.id} has no published version`);

  return {
    zoneId: zone?.id || 'default-zone',
    routeId: route.id,
    funnelId: funnel.id,
    funnelVersionId: version.id,
    checkoutMode: route.mode,
    assignmentBucket,
    entryStepId: version.entryStepId,
    currentStepId: version.entryStepId,
  };
}

export function findFunnel(funnels: FunnelConfig[] | undefined, funnelId: string) {
  return normalizeFunnelConfigs(funnels || []).find((funnel) => funnel.id === funnelId);
}

export function findFunnelVersion(
  funnels: FunnelConfig[] | undefined,
  funnelId: string,
  funnelVersionId: string
) {
  return findFunnel(funnels, funnelId)?.versions.find((version) => version.id === funnelVersionId);
}

export function findFunnelStep(
  funnels: FunnelConfig[] | undefined,
  funnelId: string,
  funnelVersionId: string,
  stepId: string
) {
  return findFunnelVersion(funnels, funnelId, funnelVersionId)?.steps.find((step) => step.id === stepId);
}

function normalizedValues(values: string[]) {
  return values.map((value) => value.toLowerCase());
}

export function matchesFunnelStep(step: FunnelStep, context: FunnelContext) {
  return step.enabled && step.triggerRules.every((rule) => {
    const expected = normalizedValues(rule.values);
    if (rule.field === 'cart_total') {
      const actual = Number(context.cartTotal || 0);
      const threshold = Number(expected[0]);
      if (!Number.isFinite(threshold)) return false;
      return rule.operator === 'greater_than' ? actual > threshold : actual === threshold;
    }
    const actual = rule.field === 'product_id'
      ? (context.items || []).map((item) => String(item.productId || '').toLowerCase()).filter(Boolean)
      : rule.field === 'variant_id'
        ? (context.items || []).map((item) => String(item.variantId || '').toLowerCase())
        : [String(rule.field === 'country' ? context.country || '' : context.utmSource || '').toLowerCase()];
    const overlaps = actual.some((item) => expected.includes(item) || expected.includes('*'));
    if (rule.operator === 'excludes') return !overlaps;
    return overlaps;
  });
}

export function nextFunnelStep(input: {
  version: FunnelVersion;
  currentStepId: string;
  decision: 'accepted' | 'declined';
  context?: FunnelContext;
}) {
  const current = input.version.steps.find((step) => step.id === input.currentStepId);
  if (!current) return undefined;
  let nextId = input.decision === 'accepted' ? current.acceptNextStepId : current.declineNextStepId;
  const visited = new Set<string>();
  while (nextId && !visited.has(nextId)) {
    visited.add(nextId);
    const step = input.version.steps.find((candidate) => candidate.id === nextId);
    if (!step) return undefined;
    if (matchesFunnelStep(step, input.context || {})) return step;
    nextId = step.declineNextStepId || step.acceptNextStepId;
  }
  return undefined;
}

export function firstPostPurchaseStep(version: FunnelVersion, context?: FunnelContext) {
  return nextFunnelStep({
    version,
    currentStepId: version.entryStepId,
    decision: 'accepted',
    context,
  });
}
