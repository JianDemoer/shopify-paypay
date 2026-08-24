import { NextRequest, NextResponse } from 'next/server';
import { createCheckoutSession } from '@/lib/checkout-sessions';
import { getStoreConfig } from '@/lib/store-configs';

export async function POST(request: NextRequest) {
  try {
    const adminToken = process.env.ADMIN_CONFIG_TOKEN;
    if (adminToken && request.headers.get('x-admin-token') !== adminToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const storeConfig = await getStoreConfig(body.storeId || body.shopDomain || body.shop);
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
    console.error('Checkout session creation failed:', error);
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}
