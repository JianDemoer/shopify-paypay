import { NextRequest, NextResponse } from 'next/server';
import { createCheckoutSession } from '@/lib/checkout-sessions';
import { verifyAppProxySearchParams } from '@/lib/shopify-app-proxy';
import { getStoreConfig } from '@/lib/store-configs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const storeConfig = await getStoreConfig(body.storeId || body.shopDomain || body.shop);

    const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    if (!verifyAppProxySearchParams(searchParams, storeConfig.shopifyAppProxySecret)) {
      return NextResponse.json({ error: 'Invalid app proxy signature' }, { status: 401 });
    }

    const session = await createCheckoutSession({
      ...body,
      storeId: storeConfig.id,
      shopDomain: storeConfig.shopDomain,
    });

    return NextResponse.json({
      sessionId: session.id,
      cid: session.cid,
      redirectUrl: `/a/s/checkout/${session.id}/entry?cid=${encodeURIComponent(session.cid)}`,
      session,
    });
  } catch (error) {
    console.error('App proxy checkout session creation failed:', error);
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}
