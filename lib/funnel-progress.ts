import type { StoreConfig } from './store-configs';
import { getCheckoutSession, updateCheckoutSession, type CheckoutSession, type UpsellState } from './checkout-sessions';
import { nextStepAfterDecision } from './funnel-runtime';
import { recordCheckoutEvent } from './checkout-events';

export async function recordFunnelDecision(
  storeConfig: StoreConfig,
  session: CheckoutSession,
  stepId: string,
  decision: 'accepted' | 'declined'
) {
  if (session.currentStepId !== stepId) throw new Error('Funnel step is no longer active');
  const currentState = session.upsellStates?.[stepId];
  if (currentState?.paymentStatus === 'paid') throw new Error('Paid funnel steps cannot be declined');
  const next = nextStepAfterDecision(storeConfig, session, decision, stepId);
  const state: UpsellState = {
    ...(currentState || { offerId: stepId }),
    offerId: currentState?.offerId || stepId,
    stepId,
    decision,
    paymentStatus: decision === 'declined' ? 'failed' : currentState?.paymentStatus,
  };
  const completedStepIds = [...new Set([...(session.completedStepIds || []), stepId])].slice(-100);
  const updated = await updateCheckoutSession(session.id, {
    upsellStates: { ...(session.upsellStates || {}), [stepId]: state },
    currentStepId: next?.id || stepId,
    completedStepIds,
    finalizationStatus: 'pending',
    finalizeAfter: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  });
  await recordCheckoutEvent({
    type: 'funnel_step_decision',
    storeId: session.storeId,
    sessionId: session.id,
    cid: session.cid,
    funnelId: session.funnelId,
    routeId: session.routeId,
    funnelVersionId: session.funnelVersionId,
    stepId,
    purchaseKind: 'upsell',
    properties: { decision },
  }).catch((error) => console.error('Funnel decision event failed:', error));
  return updated;
}

export async function getLatestSessionOrThrow(sessionId: string, storeId: string) {
  const session = await getCheckoutSession(sessionId);
  if (!session || session.storeId !== storeId) throw new Error('Checkout session not found');
  return session;
}
