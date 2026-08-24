import { NextRequest, NextResponse } from 'next/server';
import { createPayPalOrder } from '@/lib/paypal';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { amount, currency = 'USD', checkoutSessionId, cid } = body;

    if (!amount || amount <= 0 || !checkoutSessionId) {
      return NextResponse.json({ error: 'Invalid PayPal order input' }, { status: 400 });
    }

    const order = await createPayPalOrder({
      amount: Number(amount),
      currency,
      checkoutSessionId,
      cid,
    });

    return NextResponse.json({ orderId: order.id, order });
  } catch (error) {
    console.error('PayPal create order failed:', error);
    return NextResponse.json({ error: 'Failed to create PayPal order' }, { status: 500 });
  }
}
