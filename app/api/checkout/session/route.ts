import { NextRequest, NextResponse } from 'next/server';
import { createCheckoutSession } from '@/lib/checkout-sessions';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const session = createCheckoutSession(body);

    return NextResponse.json({
      sessionId: session.id,
      cid: session.cid,
      redirectUrl: `/a/s/checkout/${session.id}/entry?cid=${encodeURIComponent(session.cid)}`,
      session,
    });
  } catch (error) {
    console.error('Checkout session creation failed:', error);
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}
