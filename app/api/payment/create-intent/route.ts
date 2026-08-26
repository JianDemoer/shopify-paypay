import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createShopifyDraftOrder, resolveCheckoutLineItems } from '@/lib/shopify-admin';
import { getStoreConfig } from '@/lib/store-configs';
import {
  acquireCheckoutLock,
  getCheckoutSession,
  releaseCheckoutLock,
  releasePrimaryPaymentMethodReservation,
  reservePrimaryPaymentMethod,
  updateCheckoutSession,
  type CheckoutLineItem,
} from '@/lib/checkout-sessions';
import { calculateTotals, normalizeSourceUrl, normalizeUtm, parseCustomer } from '@/lib/checkout-pricing';
import { verifyCheckoutAccessToken } from '@/lib/checkout-access';
import { findFunnelStep, normalizeFunnelConfigs } from '@/lib/funnel-configs';
import { processStripePaymentSucceeded } from '@/lib/stripe-payment-processing';

type PurchaseKind = 'main' | 'upsell';

function purchaseKind(body: any): PurchaseKind {
  return body?.purchaseKind === 'upsell' || body?.orderType === 'post_purchase_upsell' ? 'upsell' : 'main';
}

function paymentResponse(paymentIntent: Stripe.PaymentIntent, draftOrderId = '') {
  return {
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
    status: paymentIntent.status,
    requiresAction: paymentIntent.status === 'requires_action',
    draftOrderId,
  };
}

async function ensureStripeCustomer(stripe: Stripe, session: NonNullable<Awaited<ReturnType<typeof getCheckoutSession>>>) {
  if (session.stripeCustomerId) return session.stripeCustomerId;
  if (!session.customer) throw new Error('Customer information is missing');
  const customer = await stripe.customers.create({
    email: session.customer.email,
    name: `${session.customer.firstName} ${session.customer.lastName}`.trim(),
    phone: session.customer.phone,
    metadata: { checkoutSessionId: session.id, storeId: session.storeId },
  }, { idempotencyKey: `checkout-customer:${session.id}` });
  await updateCheckoutSession(session.id, { stripeCustomerId: customer.id });
  return customer.id;
}

async function reusablePaymentMethod(stripe: Stripe, session: NonNullable<Awaited<ReturnType<typeof getCheckoutSession>>>, parentPaymentIntentId: string) {
  if (
    !parentPaymentIntentId.startsWith('pi_')
    || session.primaryPaymentStatus !== 'paid'
    || session.primaryPaymentId !== parentPaymentIntentId
  ) return null;
  if (session.stripePaymentMethodId && session.stripeCustomerId) return { customerId: session.stripeCustomerId, paymentMethodId: session.stripePaymentMethodId };
  const parent = await stripe.paymentIntents.retrieve(parentPaymentIntentId);
  if (
    parent.status !== 'succeeded'
    || parent.metadata.checkoutSessionId !== session.id
    || parent.metadata.storeId !== session.storeId
    || parent.metadata.purchaseKind !== 'main'
  ) return null;
  const paymentMethodId = typeof parent.payment_method === 'string' ? parent.payment_method : parent.payment_method?.id || '';
  const customerId = typeof parent.customer === 'string' ? parent.customer : '';
  if (!paymentMethodId || !customerId) return null;
  await updateCheckoutSession(session.id, { stripeCustomerId: customerId, stripePaymentMethodId: paymentMethodId });
  return { customerId, paymentMethodId };
}

export async function POST(request: NextRequest) {
  let requestBody: any = null;
  let paymentIntentCreated = false;
  let primaryReservationAcquired = false;
  let paymentLockKey = '';
  let paymentLockToken: string | null = null;
  let sessionId = '';
  try {
    const body = requestBody = await request.json();
    sessionId = String(body.checkoutSessionId || body.cartId || '');
    const session = sessionId ? await getCheckoutSession(sessionId) : null;
    if (!session) return NextResponse.json({ error: 'Checkout session not found' }, { status: 400 });
    const storeConfig = await getStoreConfig(session.storeId);
    if (!verifyCheckoutAccessToken(new URL(request.url).searchParams.get('checkout_token') || undefined, session.id, storeConfig.shopifyAppProxySecret)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const kind = purchaseKind(body);
    const stripe = new Stripe(storeConfig.stripeSecretKey);
    const stepId = kind === 'upsell' ? String(body.stepId || session.currentStepId || '') : '';
    const state = stepId ? session.upsellStates?.[stepId] : undefined;
    const existingPaymentId = kind === 'upsell' ? state?.paymentId : session.primaryPaymentId;
    const existingStatus = kind === 'upsell' ? state?.paymentStatus : session.primaryPaymentStatus;
    if (existingStatus === 'paid') return NextResponse.json({ error: 'This checkout step has already been paid' }, { status: 409 });

    paymentLockKey = `${storeConfig.id}:payment-init:${session.id}:${kind}:${stepId || 'main'}`;
    paymentLockToken = await acquireCheckoutLock(paymentLockKey, 120);
    if (!paymentLockToken) return NextResponse.json({ error: 'Payment setup is already in progress' }, { status: 409 });
    if (kind === 'main') {
      primaryReservationAcquired = await reservePrimaryPaymentMethod(session.id, 'stripe');
      if (!primaryReservationAcquired) return NextResponse.json({ error: 'Another payment method is already in progress' }, { status: 409 });
    }

    let items: CheckoutLineItem[];
    if (kind === 'upsell') {
      const funnels = normalizeFunnelConfigs(storeConfig.funnels, { variantId: storeConfig.upsellVariantId, productId: storeConfig.upsellProductId });
      const offerStep = session.funnelId && session.funnelVersionId && stepId ? findFunnelStep(funnels, session.funnelId, session.funnelVersionId, stepId) : undefined;
      if (!offerStep || (offerStep.type !== 'upsell' && offerStep.type !== 'downsell') || !offerStep.offer) return NextResponse.json({ error: 'Upsell step is invalid or unavailable' }, { status: 400 });
      if (session.currentStepId !== stepId) return NextResponse.json({ error: 'Upsell step is no longer active' }, { status: 409 });
      items = await resolveCheckoutLineItems(storeConfig, { variantId: offerStep.offer.variantId, quantity: offerStep.offer.quantity });
      if (offerStep.offer.priceOverride !== undefined) items = items.map((item) => ({ ...item, price: offerStep!.offer!.priceOverride! }));
    } else {
      items = session.items;
    }

    const customer = kind === 'main' ? parseCustomer(body.shippingAddress, session.customer) : session.customer;
    if (!customer) return NextResponse.json({ error: 'Shipping information is missing' }, { status: 400 });
    const method = kind === 'upsell' ? 'ships-with-original-order' : body.shippingMethod === 'express' ? 'express' : 'standard';
    const totals = calculateTotals(items, storeConfig, method, kind);
    let latestSession = session;
    if (kind === 'main' && JSON.stringify(session.customer) !== JSON.stringify(customer)) latestSession = await updateCheckoutSession(session.id, { customer });
    if (kind === 'upsell') {
      latestSession = await updateCheckoutSession(session.id, {
        upsellStates: {
          ...(session.upsellStates || {}),
          [stepId]: { ...(state || { offerId: stepId }), offerId: state?.offerId || stepId, stepId, item: items[0], paymentStatus: 'pending' },
        },
        upsellItem: items[0],
      });
    }

    if (existingPaymentId) {
      const existing = await stripe.paymentIntents.retrieve(existingPaymentId);
      if (existing.metadata.checkoutSessionId !== session.id || existing.metadata.purchaseKind !== kind) return NextResponse.json({ error: 'Payment session mismatch' }, { status: 409 });
      if (existing.amount !== Math.round(totals.total * 100)) return NextResponse.json({ error: 'Existing payment amount no longer matches checkout' }, { status: 409 });
      return NextResponse.json(paymentResponse(existing, kind === 'main' ? session.primaryDraftOrderId || '' : ''));
    }

    let draftOrderId = kind === 'main' ? latestSession.primaryDraftOrderId || '' : '';
    if (kind === 'main' && storeConfig.orderMode === 'draft_order' && !draftOrderId) {
      const draftOrder = await createShopifyDraftOrder({
        storeConfig,
        email: customer.email,
        firstName: customer.firstName,
        lastName: customer.lastName,
        lineItems: items,
        shippingAddress: customer,
        cartId: session.id,
        checkoutSessionId: session.id,
        cid: session.cid,
        sourceUrl: normalizeSourceUrl(body.sourceUrl),
        shippingMethod: method,
        orderType: 'checkout',
        utm: normalizeUtm(session.utm),
        draftKey: `${session.id}:main`,
        shippingPrice: totals.shipping,
        taxPrice: totals.tax,
      });
      draftOrderId = draftOrder.id;
      latestSession = await updateCheckoutSession(session.id, { primaryDraftOrderId: draftOrderId });
    }

    const reusable = kind === 'upsell'
      ? await reusablePaymentMethod(stripe, latestSession, String(body.parentPaymentIntentId || ''))
      : null;
    if (kind === 'upsell' && !reusable) return NextResponse.json({ error: 'This payment method cannot be reused for a one-click offer' }, { status: 409 });
    const customerId = reusable?.customerId || await ensureStripeCustomer(stripe, latestSession);
    const paymentData: Stripe.PaymentIntentCreateParams = kind === 'upsell'
      ? {
          amount: Math.round(totals.total * 100), currency: storeConfig.currency.toLowerCase(), customer: customerId,
          payment_method: reusable?.paymentMethodId,
          payment_method_types: ['card'], off_session: true, confirm: true, description: 'Post-purchase add-on',
          metadata: { checkoutSessionId: session.id, storeId: storeConfig.id, purchaseKind: kind, stepId, cid: session.cid, shippingMethod: method },
        }
      : {
          amount: Math.round(totals.total * 100), currency: storeConfig.currency.toLowerCase(), customer: customerId,
          setup_future_usage: 'off_session', payment_method_types: ['card'], description: 'Shopify checkout', receipt_email: customer.email,
          metadata: { checkoutSessionId: session.id, storeId: storeConfig.id, purchaseKind: kind, cid: session.cid, shippingMethod: method, draftOrderId },
        };
    if (kind === 'upsell' && !paymentData.payment_method) return NextResponse.json({ error: 'This payment method cannot be reused for a one-click offer' }, { status: 409 });
    const paymentIntent = await stripe.paymentIntents.create(paymentData, { idempotencyKey: `checkout:${session.id}:${kind}:${stepId || 'main'}` });
    paymentIntentCreated = true;
    await updateCheckoutSession(session.id, kind === 'upsell'
      ? { upsellStates: { ...(latestSession.upsellStates || {}), [stepId]: { ...(latestSession.upsellStates?.[stepId] || { offerId: stepId, stepId, item: items[0] }), paymentId: paymentIntent.id, paymentStatus: 'pending' } }, upsellPaymentId: paymentIntent.id, upsellPaymentStatus: 'pending' }
      : { primaryPaymentId: paymentIntent.id, primaryPaymentStatus: 'pending', primaryPaymentMethod: 'stripe', primaryShippingMethod: method === 'express' ? 'express' : 'standard' });
    if (kind === 'upsell' && paymentIntent.status === 'succeeded') await processStripePaymentSucceeded(paymentIntent, storeConfig);
    return NextResponse.json(paymentResponse(paymentIntent, draftOrderId));
  } catch (error) {
    if (error instanceof Stripe.errors.StripeCardError && purchaseKind(requestBody) === 'upsell' && error.payment_intent) {
      const paymentIntent = error.payment_intent;
      await updateCheckoutSession(sessionId, {
        upsellPaymentId: paymentIntent.id,
        upsellPaymentStatus: 'pending',
      }).catch(() => undefined);
      return NextResponse.json({
        error: 'Additional authentication is required',
        requiresAction: true,
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        status: paymentIntent.status,
      }, { status: 402 });
    }
    if (primaryReservationAcquired && !paymentIntentCreated && requestBody && purchaseKind(requestBody) === 'main' && sessionId) await releasePrimaryPaymentMethodReservation(sessionId, 'stripe').catch(() => undefined);
    console.error('Payment intent error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create payment intent' }, { status: 400 });
  } finally {
    if (paymentLockKey && paymentLockToken) await releaseCheckoutLock(paymentLockKey, paymentLockToken);
  }
}
