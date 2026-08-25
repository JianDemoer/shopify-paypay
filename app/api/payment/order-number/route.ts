import { NextResponse } from 'next/server';
import { getCheckoutSession } from '@/lib/checkout-sessions';
import { getStoreConfig } from '@/lib/store-configs';
import { verifyCheckoutAccessToken } from '@/lib/checkout-access';

export const dynamic = 'force-dynamic';

function hasTag(tags: unknown, expected: string) {
  return String(tags || '').split(',').map((tag) => tag.trim()).includes(expected);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const paymentIntentId = searchParams.get('payment_intent') || '';
    const checkoutSessionId = searchParams.get('checkout_session_id') || '';
    if (!checkoutSessionId) {
      return NextResponse.json({ error: 'checkout_session_id is required' }, { status: 400 });
    }

    const session = await getCheckoutSession(checkoutSessionId);
    if (!session) return NextResponse.json({ error: 'Checkout session not found' }, { status: 404 });
    const storeConfig = await getStoreConfig(session.storeId);
    if (!verifyCheckoutAccessToken(searchParams.get('checkout_token') || undefined, session.id, storeConfig.shopifyAppProxySecret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (session.finalizationStatus === 'completed' && session.primaryOrderId && session.primaryOrderNumber) {
      return NextResponse.json({
        orderNumber: session.primaryOrderNumber,
        shopifyOrderId: session.primaryOrderId,
        shopDomain: storeConfig.shopDomain,
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
        shopifyOrderId: knownOrderId,
        shopDomain: storeConfig.shopDomain,
      });
    }

    const tagQueries = [
      paymentIntentId ? `payment_intent:${paymentIntentId}` : '',
      `checkout_session:${checkoutSessionId}`,
      `checkout_session:${checkoutSessionId}:upsell`,
    ].filter(Boolean);

    for (const tag of tagQueries) {
      const response = await fetch(
        `https://${storeConfig.shopDomain}/admin/api/${process.env.SHOPIFY_ADMIN_API_VERSION || '2026-07'}/orders.json?status=any&limit=250&tag=${encodeURIComponent(tag)}&fields=id,order_number,tags`,
        {
          headers: {
            'X-Shopify-Access-Token': storeConfig.shopifyAdminAccessToken,
            'Content-Type': 'application/json',
          },
          cache: 'no-store',
        }
      );
      if (!response.ok) return NextResponse.json({ error: 'Failed to query Shopify' }, { status: 502 });
      const data = await response.json();
      const order = data.orders?.find((candidate: any) => hasTag(candidate.tags, tag));
      if (order) {
        return NextResponse.json({
          orderNumber: order.order_number,
          shopifyOrderId: order.id,
          shopDomain: storeConfig.shopDomain,
        });
      }
    }

    return NextResponse.json({ error: 'Order not found yet' }, { status: 404 });
  } catch (error) {
    console.error('Order retrieval error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
