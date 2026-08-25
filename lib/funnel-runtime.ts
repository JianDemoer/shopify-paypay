import type { StoreConfig } from './store-configs';
import type { CheckoutSession } from './checkout-sessions';
import {
  createLegacyDefaultFunnel,
  findFunnelStep,
  findFunnelVersion,
  firstPostPurchaseStep,
  nextFunnelStep,
  normalizeFunnelConfigs,
  type FunnelContext,
  type FunnelStep,
  type FunnelVersion,
} from './funnel-configs';

function contextFor(session: CheckoutSession): FunnelContext {
  return { items: session.items, country: session.customer?.country, utmSource: session.utm?.source, cartTotal: session.subtotal };
}

export function sessionFunnelVersion(storeConfig: StoreConfig, session: CheckoutSession): FunnelVersion | undefined {
  const funnels = normalizeFunnelConfigs(storeConfig.funnels, { variantId: storeConfig.upsellVariantId, productId: storeConfig.upsellProductId });
  if (session.funnelId && session.funnelVersionId) return findFunnelVersion(funnels, session.funnelId, session.funnelVersionId);
  return createLegacyDefaultFunnel(storeConfig.upsellVariantId, storeConfig.upsellProductId).versions[0];
}

export function sessionFunnelStep(storeConfig: StoreConfig, session: CheckoutSession, stepId = session.currentStepId) {
  if (!stepId || !session.funnelId || !session.funnelVersionId) return undefined;
  return findFunnelStep(
    normalizeFunnelConfigs(storeConfig.funnels, { variantId: storeConfig.upsellVariantId, productId: storeConfig.upsellProductId }),
    session.funnelId,
    session.funnelVersionId,
    stepId
  );
}

export function nextStepAfterDecision(storeConfig: StoreConfig, session: CheckoutSession, decision: 'accepted' | 'declined', stepId = session.currentStepId): FunnelStep | undefined {
  const version = sessionFunnelVersion(storeConfig, session);
  if (!version || !stepId) return undefined;
  return nextFunnelStep({ version, currentStepId: stepId, decision, context: contextFor(session) });
}

export function firstPendingPostPurchaseStep(storeConfig: StoreConfig, session: CheckoutSession) {
  const version = sessionFunnelVersion(storeConfig, session);
  if (!version) return undefined;
  const current = session.currentStepId ? version.steps.find((step) => step.id === session.currentStepId) : undefined;
  if (current && (current.type === 'upsell' || current.type === 'downsell' || current.type === 'thank_you')) return current;
  return firstPostPurchaseStep(version, contextFor(session));
}

export function postPurchaseComplete(storeConfig: StoreConfig, session: CheckoutSession) {
  const step = firstPendingPostPurchaseStep(storeConfig, session);
  return !step || step.type === 'thank_you';
}
