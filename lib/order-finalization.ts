import type Stripe from 'stripe';
import { calculateTotals } from './checkout-pricing';
import { acquireCheckoutLock, getCheckoutSession, releaseCheckoutLock, updateCheckoutSession, type CheckoutLineItem, type CheckoutSession } from './checkout-sessions';
import { postPurchaseComplete } from './funnel-runtime';
import type { StoreConfig } from './store-configs';
import { completeShopifyDraftOrder, createShopifyOrder, updateShopifyDraftOrder } from './shopify-admin';
import { recordCheckoutEvent } from './checkout-events';

function paidUpsellItems(session: CheckoutSession): CheckoutLineItem[] {
  const items = Object.values(session.upsellStates || {})
    .filter((state) => state.paymentStatus === 'paid' && state.item)
    .map((state) => state.item as CheckoutLineItem);
  if (!items.length && session.upsellPaymentStatus === 'paid' && session.upsellItem) return [session.upsellItem];
  return items;
}

export function bundledLineItems(session: CheckoutSession) {
  return [...session.items, ...paidUpsellItems(session)];
}

export async function finalizeCheckoutSession(sessionId: string, storeConfig: StoreConfig, options: { force?: boolean } = {}) {
  const lockKey = `${storeConfig.id}:finalize:${sessionId}`;
  const lockToken = await acquireCheckoutLock(lockKey, 180);
  if (!lockToken) {
    const current = await getCheckoutSession(sessionId);
    if (current?.finalizationStatus === 'completed' && current.primaryOrderId && current.primaryOrderNumber) {
      return { id: current.primaryOrderId, order_number: current.primaryOrderNumber, session: current };
    }
    throw new Error('Checkout finalization is already in progress');
  }

  try {
    const initial = await getCheckoutSession(sessionId);
    if (!initial || initial.storeId !== storeConfig.id) throw new Error('Checkout session not found');
    if (initial.finalizationStatus === 'completed' && initial.primaryOrderId && initial.primaryOrderNumber) {
      return { id: initial.primaryOrderId, order_number: initial.primaryOrderNumber, session: initial };
    }
    if (initial.finalizationStatus === 'processing') {
      throw new Error('Checkout finalization is already being processed');
    }
    if (initial.primaryPaymentStatus !== 'paid' || !initial.customer || !initial.primaryPaymentId) throw new Error('Primary payment is not confirmed');
    if (!options.force && !postPurchaseComplete(storeConfig, initial)) throw new Error('Post-purchase funnel is not complete');

    const latest = await updateCheckoutSession(sessionId, { finalizationStatus: 'processing' });
    const customer = latest.customer;
    const primaryPaymentId = latest.primaryPaymentId;
    if (!customer || !primaryPaymentId) throw new Error('Checkout customer or primary payment is missing');
    const items = bundledLineItems(latest);
    const totals = calculateTotals(items, storeConfig, latest.primaryShippingMethod, 'main');
    if (storeConfig.orderMode === 'draft_order' && latest.primaryDraftOrderId) {
      await updateShopifyDraftOrder({
        storeConfig,
        draftOrderId: latest.primaryDraftOrderId,
        email: customer.email,
        firstName: customer.firstName,
        lastName: customer.lastName,
        lineItems: items,
        shippingAddress: customer,
        shippingMethod: latest.primaryShippingMethod,
        shippingPrice: totals.shipping,
        taxPrice: totals.tax,
        checkoutSessionId: latest.id,
        cid: latest.cid,
        tags: ['OPC-Finalized'],
        noteAttributes: [{ name: 'bundle_item_count', value: String(items.length) }, { name: 'primary_payment_id', value: primaryPaymentId }],
      });
      const order = await completeShopifyDraftOrder({ storeConfig, draftOrderId: latest.primaryDraftOrderId });
      if (!order.order_number) throw new Error('Shopify completed the draft order without an order number');
      const completed = await updateCheckoutSession(sessionId, { finalizationStatus: 'completed', primaryOrderId: order.id, primaryOrderNumber: order.order_number, finalizedAt: new Date().toISOString() });
      await recordCheckoutEvent({ type: 'order_finalized', storeId: latest.storeId, sessionId: latest.id, cid: latest.cid, funnelId: latest.funnelId, routeId: latest.routeId, funnelVersionId: latest.funnelVersionId, value: totals.total, currency: latest.currency }).catch((error) => console.error('Order event failed:', error));
      return { ...order, session: completed };
    }
    const order = await createShopifyOrder({
      storeConfig,
      email: customer.email,
      firstName: customer.firstName,
      lastName: customer.lastName,
      lineItems: items,
      shippingAddress: customer,
      paymentIntentId: primaryPaymentId,
      cartId: latest.id,
      checkoutSessionId: latest.id,
      cid: latest.cid,
      shippingMethod: latest.primaryShippingMethod,
      shippingPrice: totals.shipping,
      taxPrice: totals.tax,
      taxRate: storeConfig.taxRate,
      orderType: 'checkout',
      utm: latest.utm || {},
    });
    if (!order.order_number) throw new Error('Shopify created the order without an order number');
    const completed = await updateCheckoutSession(sessionId, { finalizationStatus: 'completed', primaryOrderId: order.id, primaryOrderNumber: order.order_number, finalizedAt: new Date().toISOString() });
    await recordCheckoutEvent({ type: 'order_finalized', storeId: latest.storeId, sessionId: latest.id, cid: latest.cid, funnelId: latest.funnelId, routeId: latest.routeId, funnelVersionId: latest.funnelVersionId, value: totals.total, currency: latest.currency }).catch((error) => console.error('Order event failed:', error));
    return { ...order, session: completed };
  } catch (error) {
    await updateCheckoutSession(sessionId, { finalizationStatus: 'failed' }).catch(() => undefined);
    throw error;
  } finally {
    await releaseCheckoutLock(lockKey, lockToken);
  }
}

export function paymentMethodId(paymentIntent: Stripe.PaymentIntent) {
  return typeof paymentIntent.payment_method === 'string' ? paymentIntent.payment_method : paymentIntent.payment_method?.id || '';
}
