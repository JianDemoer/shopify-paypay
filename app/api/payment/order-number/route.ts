import { NextResponse } from 'next/server';
import { getCheckoutSession } from '@/lib/checkout-sessions';
import { getStoreConfig } from '@/lib/store-configs';

/**
 * GET: Retrieve order number by payment intent ID
 * 
 * Instead of relying on cached data, we query Shopify directly for orders
 * tagged with the payment intent ID. This is more resilient and doesn't
 * require synchronization between webhook and cache.
 * 
 * Called by success page polling to fetch the order confirmation number.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const paymentIntentId = searchParams.get('payment_intent');
    const checkoutSessionId = searchParams.get('checkout_session_id');
    const shopDomain = searchParams.get('shopDomain');

    if (!paymentIntentId && !checkoutSessionId) {
      return NextResponse.json(
        { error: 'Missing payment_intent or checkout_session_id parameter' },
        { status: 400 }
      );
    }

    const session = checkoutSessionId ? await getCheckoutSession(checkoutSessionId) : null;
    const storeConfig = await getStoreConfig(session?.storeId || session?.shopDomain || shopDomain);

    const shopifyResponse = await fetch(
      `https://${storeConfig.shopDomain}/admin/api/2024-01/orders.json?status=any&limit=250&fields=id,order_number,tags`,
      {
        method: 'GET',
        headers: {
          'X-Shopify-Access-Token': storeConfig.shopifyAdminAccessToken,
          'Content-Type': 'application/json',
        },
        // Critical: Don't cache the response
        // If we cache a 404, the frontend's polling loop will keep seeing 404
        // even after the order is created
        cache: 'no-store',
      }
    );

    if (!shopifyResponse.ok) {
      console.error(`Shopify API error: ${shopifyResponse.status}`);
      return NextResponse.json(
        { error: 'Failed to query Shopify' },
        { status: 500 }
      );
    }

    const data = await shopifyResponse.json();
    const expectedTags = [
      paymentIntentId ? `payment_intent:${paymentIntentId}` : '',
      checkoutSessionId ? `checkout_session:${checkoutSessionId}` : '',
      checkoutSessionId ? `checkout_session:${checkoutSessionId}:upsell` : '',
    ].filter(Boolean);

    const order = data.orders?.find((candidate: any) => {
      const tags = String(candidate.tags || '');
      return expectedTags.some((tag) => tags.includes(tag));
    });

    if (!order) {
      // Order not found yet (webhook still processing)
      // Frontend will retry in 2 seconds
      return NextResponse.json(
        { error: 'Order not found yet' },
        { status: 404 }
      );
    }

    // Success! Return the order number for the frontend
    // Example response: { orderNumber: 1017 }
    console.log(`✅ Found order #${order.order_number}`);

    return NextResponse.json(
      {
        orderNumber: order.order_number,
        shopifyOrderId: order.id,
        shopDomain: storeConfig.shopDomain,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('❌ Order retrieval error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
