import { NextRequest, NextResponse } from 'next/server';
import { createPayPalOrder } from '@/lib/paypal';
import { createShopifyDraftOrder, resolveCheckoutLineItems } from '@/lib/shopify-admin';
import { getStoreConfig } from '@/lib/store-configs';
import { findFunnelStep, normalizeFunnelConfigs } from '@/lib/funnel-configs';
import { acquireCheckoutLock, getCheckoutSession, releaseCheckoutLock, releasePrimaryPaymentMethodReservation, reservePrimaryPaymentMethod, updateCheckoutSession } from '@/lib/checkout-sessions';
import { calculateTotals, normalizeUtm, parseCustomer } from '@/lib/checkout-pricing';
import { verifyCheckoutAccessToken } from '@/lib/checkout-access';

export async function POST(request: NextRequest) {
  let reservedSessionId = '';
  let primaryReservationAcquired = false;
  let paypalOrderCreated = false;
  let lockKey = '';
  let lockToken: string | null = null;
  try {
    const body = await request.json();
    const session = body.checkoutSessionId ? await getCheckoutSession(String(body.checkoutSessionId)) : null;
    if (!session) return NextResponse.json({ error: 'Invalid PayPal order input' }, { status: 400 });
    const storeConfig = await getStoreConfig(session.storeId);
    reservedSessionId = session.id;
    if (!verifyCheckoutAccessToken(new URL(request.url).searchParams.get('checkout_token') || undefined, session.id, storeConfig.shopifyAppProxySecret)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const kind = body.purchaseKind === 'upsell' ? 'upsell' : 'main';
    const stepId = kind === 'upsell' ? String(body.stepId || session.currentStepId || '') : '';
    let items = session.items;
    let method: 'standard' | 'express' | 'ships-with-original-order' = body.shippingMethod === 'express' ? 'express' : 'standard';
    if (kind === 'upsell') {
      if (session.primaryPaymentStatus !== 'paid' || String(body.parentPaymentIntentId || '') !== session.primaryPaymentId) return NextResponse.json({ error: 'Original PayPal payment is not confirmed' }, { status: 409 });
      const funnels = normalizeFunnelConfigs(storeConfig.funnels, { variantId: storeConfig.upsellVariantId, productId: storeConfig.upsellProductId });
      const step = session.funnelId && session.funnelVersionId ? findFunnelStep(funnels, session.funnelId, session.funnelVersionId, stepId) : undefined;
      if (!step || (step.type !== 'upsell' && step.type !== 'downsell') || !step.offer || session.currentStepId !== stepId) return NextResponse.json({ error: 'Upsell step is no longer active' }, { status: 409 });
      items = await resolveCheckoutLineItems(storeConfig, { variantId: step.offer.variantId, quantity: step.offer.quantity });
      if (step.offer.priceOverride !== undefined) items = items.map((item) => ({ ...item, price: step.offer!.priceOverride! }));
      method = 'ships-with-original-order';
    } else {
      if (session.primaryPaymentStatus === 'paid') return NextResponse.json({ error: 'Checkout already paid' }, { status: 409 });
    }

    const customer = parseCustomer(kind === 'main' ? body.shippingAddress : undefined, session.customer);
    const totals = calculateTotals(items, storeConfig, method, kind);
    lockKey = `${storeConfig.id}:paypal:${session.id}:${kind}:${stepId || 'main'}`;
    lockToken = await acquireCheckoutLock(lockKey, 120);
    if (!lockToken) return NextResponse.json({ error: 'PayPal order creation is already in progress' }, { status: 409 });

    const latestSession = await getCheckoutSession(session.id);
    if (!latestSession) return NextResponse.json({ error: 'Checkout session not found' }, { status: 404 });
    const existingOrderId = kind === 'main' ? latestSession.paypalOrderId : latestSession.paypalOrderIds?.[stepId];
    if (existingOrderId) return NextResponse.json({ orderId: existingOrderId });

    if (kind === 'main') {
      primaryReservationAcquired = await reservePrimaryPaymentMethod(session.id, 'paypal');
      if (!primaryReservationAcquired) return NextResponse.json({ error: 'Another payment method is already in progress' }, { status: 409 });
    }

    let draftOrderId = kind === 'main' ? latestSession.primaryDraftOrderId || '' : '';
    if (kind === 'main' && storeConfig.orderMode === 'draft_order' && !draftOrderId) {
      const draft = await createShopifyDraftOrder({
        storeConfig,
        email: customer.email,
        firstName: customer.firstName,
        lastName: customer.lastName,
        lineItems: items,
        shippingAddress: customer,
        cartId: session.id,
        checkoutSessionId: session.id,
        cid: session.cid,
        shippingMethod: method,
        orderType: 'paypal_checkout',
        utm: normalizeUtm(session.utm),
        draftKey: `${session.id}:main`,
        shippingPrice: totals.shipping,
        taxPrice: totals.tax,
      });
      draftOrderId = draft.id;
    }

    const order = await createPayPalOrder({
      storeConfig,
      amount: totals.total,
      currency: storeConfig.currency,
      checkoutSessionId: session.id,
      cid: session.cid,
      purchaseKind: kind,
      stepId: stepId || undefined,
    });
    paypalOrderCreated = true;

    await updateCheckoutSession(session.id, kind === 'main'
      ? { customer, paypalOrderId: order.id, primaryDraftOrderId: draftOrderId || latestSession.primaryDraftOrderId, primaryPaymentStatus: 'pending', primaryShippingMethod: method === 'express' ? 'express' : 'standard' }
      : {
          upsellStates: { ...(latestSession.upsellStates || {}), [stepId]: { ...(latestSession.upsellStates?.[stepId] || { offerId: stepId, stepId, item: items[0] }), item: items[0], paymentStatus: 'pending' } },
          paypalOrderIds: { ...(latestSession.paypalOrderIds || {}), [stepId]: order.id },
          upsellItem: items[0],
        });
    return NextResponse.json({ orderId: order.id, order });
  } catch (error) {
    if (primaryReservationAcquired && reservedSessionId && !paypalOrderCreated) await releasePrimaryPaymentMethodReservation(reservedSessionId, 'paypal').catch(() => undefined);
    console.error('PayPal create order failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create PayPal order' }, { status: 400 });
  } finally {
    if (lockKey && lockToken) await releaseCheckoutLock(lockKey, lockToken);
  }
}
