import { NextResponse } from 'next/server';
import { getCheckoutSession } from '@/lib/checkout-sessions';
import { getStoreConfig } from '@/lib/store-configs';
import { verifyCheckoutAccessToken } from '@/lib/checkout-access';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const session = await getCheckoutSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Checkout session not found' }, { status: 404 });
  }
  const storeConfig = await getStoreConfig(session.storeId);
  const token = new URL(request.url).searchParams.get('checkout_token') || undefined;
  if (!verifyCheckoutAccessToken(token, session.id, storeConfig.shopifyAppProxySecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ session });
}
