import { NextRequest, NextResponse } from 'next/server';
import { capturePayPalOrder } from '@/lib/paypal';
import { createShopifyOrder } from '@/lib/shopify-admin';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      orderId,
      checkoutSessionId,
      cid,
      amount,
      currency = 'USD',
      lineItems,
      shippingAddress,
      sourceUrl,
      shippingMethod,
      utm,
    } = body;

    if (!orderId || !checkoutSessionId || !amount) {
      return NextResponse.json({ error: 'Invalid PayPal capture input' }, { status: 400 });
    }

    const capture = await capturePayPalOrder(orderId);
    const payer = capture?.payer || {};
    const captureId = capture?.purchase_units?.[0]?.payments?.captures?.[0]?.id || orderId;
    const email = payer.email_address || shippingAddress?.email || 'noreply@paypal-payment.local';
    const firstName = shippingAddress?.firstName || payer.name?.given_name || 'PayPal';
    const lastName = shippingAddress?.lastName || payer.name?.surname || 'Customer';

    const shopifyOrder = await createShopifyOrder({
      email,
      firstName,
      lastName,
      lineItems: lineItems || [],
      shippingAddress,
      paymentIntentId: `paypal:${captureId}`,
      cartId: checkoutSessionId,
      checkoutSessionId,
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
