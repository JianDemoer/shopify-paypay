import { NextResponse } from 'next/server';
import { getCheckoutSession } from '@/lib/checkout-sessions';
import { getStoreConfig } from '@/lib/store-configs';
import { verifyCheckoutAccessToken } from '@/lib/checkout-access';
import { finalizeCheckoutSession } from '@/lib/order-finalization';
import { findShopifyOrderByTag } from '@/lib/shopify-admin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const paymentIntentId = searchParams.get('payment_intent') || '';
    const checkoutSessionId = searchParams.get('checkout_session_id') || '';
    if (!checkoutSessionId) {
      return NextResponse.json({ error: 'checkout_session_id is required' }, { status: 400 });
    }

    let session = await getCheckoutSession(checkoutSessionId);
    if (!session) return NextResponse.json({ error: 'Checkout session not found' }, { status: 404 });
    const storeConfig = await getStoreConfig(session.storeId);
    if (!verifyCheckoutAccessToken(searchParams.get('checkout_token') || undefined, session.id, storeConfig.shopifyAppProxySecret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (
      session.primaryPaymentStatus === 'paid'
      && session.finalizationStatus !== 'completed'
      && session.finalizeAfter
      && new Date(session.finalizeAfter).getTime() <= Date.now()
    ) {
      try {
        const finalized = await finalizeCheckoutSession(session.id, storeConfig, { force: true });
        session = finalized.session;
      } catch (error) {
        console.error('Checkout finalization retry failed:', error);
      }
    }

    if (session.finalizationStatus === 'completed' && session.primaryOrderId && session.primaryOrderNumber) {
      return NextResponse.json({
        orderNumber: session.primaryOrderNumber,
      });
    }

    const isUpsell = Boolean(paymentIntentId && paymentIntentId === session.upsellPaymentId);
    const knownOrderId = isUpsell ? session.upsellOrderId : session.primaryOrderId;
    const knownOrderNumber = isUpsell ? session.upsellOrderNumber : session.primaryOrderNumber;
    const knownPaymentId = isUpsell ? session.upsellPaymentId : session.primaryPaymentId;
    const knownStatus = isUpsell ? session.upsellPaymentStatus : session.primaryPaymentStatus;
    if (knownOrderId && knownOrderNumber && knownStatus === 'paid' && (!paymentIntentId || paymentIntentId === knownPaymentId || paymentIntentId.startsWith('paypal:'))) {
      return NextResponse.json({
        orderNumber: knownOrderNumber,
      });
    }

    const tagQueries = [
      paymentIntentId ? `payment_intent:${paymentIntentId}` : '',
      `checkout_session:${checkoutSessionId}`,
      `checkout_session:${checkoutSessionId}:upsell`,
    ].filter(Boolean);

    for (const tag of tagQueries) {
      const order = await findShopifyOrderByTag(storeConfig, tag);
      if (order) {
        return NextResponse.json({
          orderNumber: order.order_number,
        });
      }
    }

    return NextResponse.json({ error: 'Order not found yet' }, { status: 404 });
  } catch (error) {
    console.error('Order retrieval error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
