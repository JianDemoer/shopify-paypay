import { NextRequest, NextResponse } from 'next/server';
import { capturePayPalOrder, getPayPalOrder } from '@/lib/paypal';
import { getStoreConfig } from '@/lib/store-configs';
import { findFunnelStep, normalizeFunnelConfigs } from '@/lib/funnel-configs';
import { acquireCheckoutLock, getCheckoutSession, releaseCheckoutLock } from '@/lib/checkout-sessions';
import { calculateTotals } from '@/lib/checkout-pricing';
import { verifyCheckoutAccessToken } from '@/lib/checkout-access';
import { processPayPalMainSucceeded, processPayPalUpsellSucceeded } from '@/lib/paypal-payment-processing';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const orderId = String(body.orderId || '');
    const session = body.checkoutSessionId ? await getCheckoutSession(String(body.checkoutSessionId)) : null;
    if (!orderId || !session) return NextResponse.json({ error: 'Invalid PayPal capture input' }, { status: 400 });
    const storeConfig = await getStoreConfig(session.storeId);
    if (!verifyCheckoutAccessToken(new URL(request.url).searchParams.get('checkout_token') || undefined, session.id, storeConfig.shopifyAppProxySecret)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const kind = body.purchaseKind === 'upsell' ? 'upsell' : 'main';
    const stepId = kind === 'upsell' ? String(body.stepId || session.currentStepId || '') : '';
    const expectedPayPalOrderId = kind === 'main' ? session.paypalOrderId : session.paypalOrderIds?.[stepId];
    if (expectedPayPalOrderId !== orderId) return NextResponse.json({ error: 'PayPal order mismatch' }, { status: 409 });
    if (!session.customer) return NextResponse.json({ error: 'Shipping information is missing' }, { status: 400 });

    const lockKey = `${storeConfig.id}:paypal-capture:${session.id}:${kind}:${stepId || orderId}`;
    const lockToken = await acquireCheckoutLock(lockKey, 120);
    if (!lockToken) return NextResponse.json({ error: 'PayPal capture is already in progress' }, { status: 409 });
    try {
      const latestSession = await getCheckoutSession(session.id);
      if (!latestSession?.customer) return NextResponse.json({ error: 'Shipping information is missing' }, { status: 400 });
      const remoteOrder = await getPayPalOrder(storeConfig, orderId);
      const unit = remoteOrder.purchase_units?.[0];
      const remoteAmount = unit?.amount;
      let items = latestSession.items;
      let method: 'standard' | 'express' | 'ships-with-original-order' = latestSession.primaryShippingMethod || 'standard';
      if (kind === 'upsell') {
        const funnels = normalizeFunnelConfigs(storeConfig.funnels, { variantId: storeConfig.upsellVariantId, productId: storeConfig.upsellProductId });
        const step = latestSession.funnelId && latestSession.funnelVersionId ? findFunnelStep(funnels, latestSession.funnelId, latestSession.funnelVersionId, stepId) : undefined;
        const item = latestSession.upsellStates?.[stepId]?.item || latestSession.upsellItem;
        if (!step || !item || latestSession.currentStepId !== stepId) return NextResponse.json({ error: 'Upsell step is no longer active' }, { status: 409 });
        items = [item];
        method = 'ships-with-original-order';
      }
      const expected = calculateTotals(items, storeConfig, method, kind);
      const expectedCustomId = `${latestSession.id}:${stepId || 'main'}`;
      if (
        unit?.custom_id !== expectedCustomId
        || String(remoteAmount?.currency_code || '').toUpperCase() !== storeConfig.currency.toUpperCase()
        || Math.round(Number(remoteAmount?.value) * 100) !== Math.round(expected.total * 100)
      ) return NextResponse.json({ error: 'PayPal order amount or session mismatch' }, { status: 409 });

      const capture = remoteOrder.status === 'COMPLETED' ? remoteOrder : await capturePayPalOrder(storeConfig, orderId);
      const captureId = capture?.purchase_units?.[0]?.payments?.captures?.[0]?.id || orderId;
      const paymentId = `paypal:${captureId}`;
      if (kind === 'main') {
        const progressed = await processPayPalMainSucceeded(latestSession.id, storeConfig, paymentId);
        return NextResponse.json({ capture, orderNumber: progressed.primaryOrderNumber, shopifyOrderId: progressed.primaryOrderId, paymentId, nextStepId: progressed.currentStepId });
      }
      const progressed = await processPayPalUpsellSucceeded(latestSession.id, storeConfig, stepId, paymentId);
      return NextResponse.json({ capture, orderNumber: progressed.primaryOrderNumber, shopifyOrderId: progressed.primaryOrderId, paymentId, nextStepId: progressed.currentStepId });
    } finally {
      await releaseCheckoutLock(lockKey, lockToken);
    }
  } catch (error) {
    console.error('PayPal capture failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to capture PayPal order' }, { status: 400 });
  }
}
