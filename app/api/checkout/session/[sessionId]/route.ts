import { NextResponse } from 'next/server';
import { getCheckoutSession } from '@/lib/checkout-sessions';

export async function GET(
  _request: Request,
  { params }: { params: { sessionId: string } }
) {
  const session = await getCheckoutSession(params.sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Checkout session not found' }, { status: 404 });
  }
  return NextResponse.json({ session });
}
