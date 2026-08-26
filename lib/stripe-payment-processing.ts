import Stripe from 'stripe';
import { calculateTotals } from './checkout-pricing';
import { getCheckoutSession, updateCheckoutSession, type CheckoutSession } from './checkout-sessions';
import { nextStepAfterDecision, sessionFunnelVersion } from './funnel-runtime';
import { finalizeCheckoutSession, paymentMethodId } from './order-finalization';
import type { StoreConfig } from './store-configs';
import { recordCheckoutEvent } from './checkout-events';
import { checkoutFinalizationDeadline, scheduleCheckoutFinalizationSafely } from './checkout-finalization-scheduler';

function nextCompletedSteps(session: CheckoutSession, stepId: string) {
  return [...new Set([...(session.completedStepIds || []), stepId])].slice(-100);
}

function itemForUpsell(session: CheckoutSession, stepId: string) {
  const state = session.upsellStates?.[stepId];
  return state?.item || (session.currentStepId === stepId ? session.upsellItem : undefined);
}

export async function processStripePaymentSucceeded(paymentIntent: Stripe.PaymentIntent, storeConfig: StoreConfig) {
  const metadata = paymentIntent.metadata || {};
  const sessionId = String(metadata.checkoutSessionId || '');
  const kind = metadata.purchaseKind === 'upsell' ? 'upsell' : 'main';
  if (!sessionId || metadata.storeId !== storeConfig.id) throw new Error('Stripe payment metadata is not bound to the verified store');
  const session = await getCheckoutSession(sessionId);
  if (!session || session.storeId !== storeConfig.id || !session.customer) throw new Error('Checkout session is missing or belongs to another store');
  const stepId = kind === 'upsell' ? String(metadata.stepId || session.currentStepId || '') : String(session.currentStepId || sessionFunnelVersion(storeConfig, session)?.entryStepId || '');
  const item = kind === 'upsell' ? itemForUpsell(session, stepId) : undefined;
  const items = kind === 'upsell' ? (item ? [item] : []) : session.items;
  if (!items.length) throw new Error('Checkout session is missing paid line items');
  const totals = calculateTotals(items, storeConfig, metadata.shippingMethod, kind);
  if (paymentIntent.amount !== Math.round(totals.total * 100) || paymentIntent.currency.toUpperCase() !== storeConfig.currency.toUpperCase()) throw new Error('Stripe amount or currency does not match the checkout session');

  if (kind === 'main') {
    if (session.primaryPaymentId && session.primaryPaymentId !== paymentIntent.id) throw new Error('Payment intent does not match the checkout session');
    if (session.primaryPaymentStatus === 'paid' && session.primaryPaymentId === paymentIntent.id) return { session, order: session.primaryOrderId ? { id: session.primaryOrderId, order_number: session.primaryOrderNumber || 0 } : undefined };
    const version = sessionFunnelVersion(storeConfig, session);
    const entryStepId = version?.entryStepId || session.currentStepId || '';
    const next = version && entryStepId ? nextStepAfterDecision(storeConfig, session, 'accepted', entryStepId) : undefined;
    const finalizeAfter = checkoutFinalizationDeadline();
    const updated = await updateCheckoutSession(session.id, {
      primaryPaymentId: paymentIntent.id,
      primaryPaymentStatus: 'paid',
      stripeCustomerId: typeof paymentIntent.customer === 'string' ? paymentIntent.customer : session.stripeCustomerId,
      stripePaymentMethodId: paymentMethodId(paymentIntent) || session.stripePaymentMethodId,
      currentStepId: next?.id || entryStepId,
      completedStepIds: nextCompletedSteps(session, entryStepId),
      finalizationStatus: 'pending',
      finalizeAfter,
    });
    await scheduleCheckoutFinalizationSafely(session.id, finalizeAfter);
    await recordCheckoutEvent({ type: 'payment_succeeded', storeId: session.storeId, sessionId: session.id, cid: session.cid, funnelId: session.funnelId, routeId: session.routeId, funnelVersionId: session.funnelVersionId, stepId: entryStepId, purchaseKind: 'main', value: totals.total, currency: session.currency }).catch((error) => console.error('Payment event failed:', error));
    if (!next || next.type === 'thank_you') {
      const finalized = await finalizeCheckoutSession(session.id, storeConfig, { force: true });
      return { session: finalized.session, order: finalized };
    }
    return { session: updated };
  }

  if (!stepId) throw new Error('Upsell step is missing');
  const currentState = session.upsellStates?.[stepId];
  if (currentState?.paymentId && currentState.paymentId !== paymentIntent.id) throw new Error('Upsell payment intent does not match the checkout step');
  if (currentState?.paymentStatus === 'paid' && currentState.paymentId === paymentIntent.id) return { session, order: session.primaryOrderId ? { id: session.primaryOrderId, order_number: session.primaryOrderNumber || 0 } : undefined };
  const next = nextStepAfterDecision(storeConfig, session, 'accepted', stepId);
  const states = {
    ...(session.upsellStates || {}),
    [stepId]: { ...(currentState || { offerId: stepId }), offerId: currentState?.offerId || stepId, stepId, paymentId: paymentIntent.id, paymentStatus: 'paid' as const, decision: 'accepted' as const },
  };
  const finalizeAfter = checkoutFinalizationDeadline();
  const updated = await updateCheckoutSession(session.id, { upsellStates: states, upsellPaymentId: paymentIntent.id, upsellPaymentStatus: 'paid', currentStepId: next?.id || stepId, completedStepIds: nextCompletedSteps(session, stepId), finalizationStatus: 'pending', finalizeAfter });
  await scheduleCheckoutFinalizationSafely(session.id, finalizeAfter);
  await recordCheckoutEvent({ type: 'payment_succeeded', storeId: session.storeId, sessionId: session.id, cid: session.cid, funnelId: session.funnelId, routeId: session.routeId, funnelVersionId: session.funnelVersionId, stepId, purchaseKind: 'upsell', value: totals.total, currency: session.currency }).catch((error) => console.error('Upsell payment event failed:', error));
  if (!next || next.type === 'thank_you') {
    const finalized = await finalizeCheckoutSession(session.id, storeConfig, { force: true });
    return { session: finalized.session, order: finalized };
  }
  return { session: updated };
}
