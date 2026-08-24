import { NextRequest, NextResponse } from 'next/server';
import { createPayPalOrder } from '@/lib/paypal';
import { getStoreConfig } from '@/lib/store-configs';
import { getCheckoutSession } from '@/lib/checkout-sessions';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { checkoutSessionId, cid, shippingMethod } = body;

    const session = checkoutSessionId ? await getCheckoutSession(checkoutSessionId) : null;
    if (!session) {
      return NextResponse.json({ error: 'Invalid PayPal order input' }, { status: 400 });
    }

    const shipping = shippingMethod === 'express' ? 5.99 : session.shipping;
    const amount = Number((session.subtotal + shipping + session.tax).toFixed(2));
    const storeConfig = await getStoreConfig(session.storeId || session.shopDomain);
    const order = await createPayPalOrder({
      storeConfig,
      amount,
      currency: session.currency,
      checkoutSessionId: session.id,
      cid,
    });

    return NextResponse.json({ orderId: order.id, order });
  } catch (error) {
    console.error('PayPal create order failed:', error);
    return NextResponse.json({ error: 'Failed to create PayPal order' }, { status: 500 });
  }
}
