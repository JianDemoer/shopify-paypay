import { NextRequest, NextResponse } from 'next/server';
import { getCheckoutSession } from '@/lib/checkout-sessions';
import { verifyCheckoutAccessToken } from '@/lib/checkout-access';
import { prepareCheckoutSession } from '@/lib/checkout-preparation';
import { recordCheckoutEvent } from '@/lib/checkout-events';
import { getStoreConfig } from '@/lib/store-configs';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sessionId = String(body.checkoutSessionId || '');
    if (!sessionId) return NextResponse.json({ error: 'Checkout session is required' }, { status: 400 });

    const session = await getCheckoutSession(sessionId);
    if (!session) return NextResponse.json({ error: 'Checkout session not found' }, { status: 404 });
    const storeConfig = await getStoreConfig(session.storeId);
    const token = new URL(request.url).searchParams.get('checkout_token') || undefined;
    if (!verifyCheckoutAccessToken(token, session.id, storeConfig.shopifyAppProxySecret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const prepared = await prepareCheckoutSession(session.id, storeConfig, {
      customer: body.shippingAddress || body.customer,
      shippingMethod: body.shippingMethod,
      sourceUrl: body.sourceUrl,
    });
    const eventBase = {
      storeId: prepared.session.storeId,
      sessionId: prepared.session.id,
      cid: prepared.session.cid,
      funnelId: prepared.session.funnelId,
      routeId: prepared.session.routeId,
      funnelVersionId: prepared.session.funnelVersionId,
      value: prepared.session.total,
      currency: prepared.session.currency,
    };
    if (prepared.submittedContact) {
      await recordCheckoutEvent({ type: 'contact_submitted', ...eventBase }).catch((error) => console.error('Contact event failed:', error));
    }
    if (prepared.reviewed) {
      await recordCheckoutEvent({
        type: 'checkout_reviewed',
        ...eventBase,
        properties: { draft_created: prepared.createdDraft, shipping_method: prepared.session.primaryShippingMethod || 'standard' },
      }).catch((error) => console.error('Checkout review event failed:', error));
    }

    return NextResponse.json({
      ok: true,
      draftOrderId: prepared.session.primaryDraftOrderId,
      session: prepared.session,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to save checkout details' },
      { status: 400 }
    );
  }
}
