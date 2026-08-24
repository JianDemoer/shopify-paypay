import { NextRequest, NextResponse } from 'next/server';
import { capturePayPalOrder } from '@/lib/paypal';
import { createShopifyOrder } from '@/lib/shopify-admin';
import { getStoreConfig } from '@/lib/store-configs';
import { getCheckoutSession } from '@/lib/checkout-sessions';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      orderId,
      checkoutSessionId,
      cid,
      shippingAddress,
      sourceUrl,
      shippingMethod,
      utm,
    } = body;

    const session = checkoutSessionId ? await getCheckoutSession(checkoutSessionId) : null;
    if (!orderId || !session) {
      return NextResponse.json({ error: 'Invalid PayPal capture input' }, { status: 400 });
    }

    const storeConfig = await getStoreConfig(session.storeId || session.shopDomain);
    const capture = await capturePayPalOrder(storeConfig, orderId);
    const payer = capture?.payer || {};
    const captureId = capture?.purchase_units?.[0]?.payments?.captures?.[0]?.id || orderId;
    const email = payer.email_address || shippingAddress?.email || 'noreply@paypal-payment.local';
    const firstName = shippingAddress?.firstName || payer.name?.given_name || 'PayPal';
    const lastName = shippingAddress?.lastName || payer.name?.surname || 'Customer';

    const shopifyOrder = await createShopifyOrder({
      storeConfig,
      email,
      firstName,
      lastName,
      lineItems: session.items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        title: item.title,
        price: item.price,
      })),
      shippingAddress,
      paymentIntentId: `paypal:${captureId}`,
      cartId: session.id,
      checkoutSessionId: session.id,
      cid,
      sourceUrl,
      shippingMethod,
      orderType: 'paypal_checkout',
      utm: utm || {},
    });

    return NextResponse.json({
      capture,
      orderNumber: shopifyOrder.order_number,
      shopifyOrderId: shopifyOrder.id,
      paymentId: `paypal:${captureId}`,
    });
  } catch (error) {
    console.error('PayPal capture failed:', error);
    return NextResponse.json({ error: 'Failed to capture PayPal order' }, { status: 500 });
  }
}
