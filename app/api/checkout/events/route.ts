import { NextRequest, NextResponse } from 'next/server';
import { getCheckoutSession } from '@/lib/checkout-sessions';
import { getStoreConfig } from '@/lib/store-configs';
import { verifyCheckoutAccessToken } from '@/lib/checkout-access';
import { recordCheckoutEvent } from '@/lib/checkout-events';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sessionId = String(body.sessionId || body.checkoutSessionId || '');
    const session = await getCheckoutSession(sessionId);
    if (!session) return NextResponse.json({ error: 'Checkout session not found' }, { status: 404 });
    const storeConfig = await getStoreConfig(session.storeId);
    if (!verifyCheckoutAccessToken(new URL(request.url).searchParams.get('checkout_token') || undefined, session.id, storeConfig.shopifyAppProxySecret)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const event = await recordCheckoutEvent({
      ...body,
      sessionId: session.id,
      storeId: session.storeId,
      cid: session.cid,
      funnelId: session.funnelId,
      routeId: session.routeId,
      funnelVersionId: session.funnelVersionId,
      currency: session.currency,
    });
    return NextResponse.json({ ok: true, eventId: event.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to record event' }, { status: 400 });
  }
}
