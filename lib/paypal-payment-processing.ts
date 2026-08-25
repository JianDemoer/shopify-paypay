import { calculateTotals } from './checkout-pricing';
import { getCheckoutSession, updateCheckoutSession, type CheckoutSession } from './checkout-sessions';
import { nextStepAfterDecision, sessionFunnelVersion } from './funnel-runtime';
import { finalizeCheckoutSession } from './order-finalization';
import type { StoreConfig } from './store-configs';
import { recordCheckoutEvent } from './checkout-events';

function completedSteps(session: CheckoutSession, stepId: string) {
  return [...new Set([...(session.completedStepIds || []), stepId])].slice(-100);
}

export async function processPayPalMainSucceeded(sessionId: string, storeConfig: StoreConfig, paymentId: string) {
  const session = await getCheckoutSession(sessionId);
  if (!session || session.storeId !== storeConfig.id || !session.customer) throw new Error('Checkout session is missing');
  if (session.primaryPaymentStatus === 'paid' && session.primaryPaymentId === paymentId) return session;
  if (session.primaryPaymentStatus === 'paid' && session.primaryPaymentId !== paymentId) throw new Error('PayPal payment does not match the checkout session');
  const method = session.primaryShippingMethod || 'standard';
  const expected = calculateTotals(session.items, storeConfig, method, 'main');
  const version = sessionFunnelVersion(storeConfig, session);
  const entryStepId = version?.entryStepId || session.currentStepId || '';
  const next = version && entryStepId ? nextStepAfterDecision(storeConfig, session, 'accepted', entryStepId) : undefined;
  const updated = await updateCheckoutSession(sessionId, {
    primaryPaymentId: paymentId,
    primaryPaymentStatus: 'paid',
    currentStepId: next?.id || entryStepId,
    completedStepIds: completedSteps(session, entryStepId),
    finalizationStatus: 'pending',
    finalizeAfter: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  });
  await recordCheckoutEvent({ type: 'payment_succeeded', storeId: session.storeId, sessionId: session.id, cid: session.cid, funnelId: session.funnelId, routeId: session.routeId, funnelVersionId: session.funnelVersionId, stepId: entryStepId, purchaseKind: 'main', value: expected.total, currency: session.currency }).catch((error) => console.error('PayPal payment event failed:', error));
  if (!next || next.type === 'thank_you') return (await finalizeCheckoutSession(sessionId, storeConfig, { force: true })).session;
  return updated;
}

export async function processPayPalUpsellSucceeded(sessionId: string, storeConfig: StoreConfig, stepId: string, paymentId: string) {
  const session = await getCheckoutSession(sessionId);
  if (!session || session.storeId !== storeConfig.id) throw new Error('Checkout session is missing');
  const current = session.upsellStates?.[stepId];
  if (current?.paymentStatus === 'paid' && current.paymentId === paymentId) return session;
  if (current?.paymentStatus === 'paid' && current.paymentId !== paymentId) throw new Error('PayPal add-on payment does not match the checkout step');
  if (session.primaryPaymentStatus !== 'paid') throw new Error('Original PayPal payment is not confirmed');
  if (session.currentStepId !== stepId) throw new Error('Funnel step is no longer active');
  const item = current?.item || session.upsellItem;
  if (!item) throw new Error('Checkout session is missing the paid add-on');
  const totals = calculateTotals([item], storeConfig, 'ships-with-original-order', 'upsell');
  const next = nextStepAfterDecision(storeConfig, session, 'accepted', stepId);
  const updated = await updateCheckoutSession(sessionId, {
    upsellStates: {
      ...(session.upsellStates || {}),
      [stepId]: { ...(current || { offerId: stepId, stepId }), item, paymentId, paymentStatus: 'paid', decision: 'accepted' },
    },
    upsellPaymentId: paymentId,
    upsellPaymentStatus: 'paid',
    currentStepId: next?.id || stepId,
    completedStepIds: completedSteps(session, stepId),
    finalizationStatus: 'pending',
    finalizeAfter: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  });
  await recordCheckoutEvent({ type: 'payment_succeeded', storeId: session.storeId, sessionId: session.id, cid: session.cid, funnelId: session.funnelId, routeId: session.routeId, funnelVersionId: session.funnelVersionId, stepId, purchaseKind: 'upsell', value: totals.total, currency: session.currency }).catch((error) => console.error('PayPal upsell event failed:', error));
  if (!next || next.type === 'thank_you') return (await finalizeCheckoutSession(sessionId, storeConfig, { force: true })).session;
  return updated;
}
