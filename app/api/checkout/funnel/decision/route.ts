import { NextRequest, NextResponse } from 'next/server';
import { getStoreConfig } from '@/lib/store-configs';
import { getCheckoutSession } from '@/lib/checkout-sessions';
import { verifyCheckoutAccessToken } from '@/lib/checkout-access';
import { recordFunnelDecision } from '@/lib/funnel-progress';
import { finalizeCheckoutSession } from '@/lib/order-finalization';
import { sessionFunnelStep } from '@/lib/funnel-runtime';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sessionId = String(body.checkoutSessionId || '');
    const stepId = String(body.stepId || '');
    const decision = body.decision === 'accepted' || body.decision === 'declined' ? body.decision : '';
    const preview = body.preview === true;
    if (!sessionId || !stepId || !decision) return NextResponse.json({ error: 'Invalid funnel decision' }, { status: 400 });
    const session = await getCheckoutSession(sessionId);
    if (!session) return NextResponse.json({ error: 'Checkout session not found' }, { status: 404 });
    const storeConfig = await getStoreConfig(session.storeId);
    if (!verifyCheckoutAccessToken(new URL(request.url).searchParams.get('checkout_token') || undefined, session.id, storeConfig.shopifyAppProxySecret)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!preview && session.primaryPaymentStatus !== 'paid') {
      return NextResponse.json({ error: 'Payment is not confirmed for this checkout' }, { status: 409 });
    }
    if (preview && (session.checkoutStatus !== 'ready_for_payment' || !session.primaryDraftOrderId)) {
      return NextResponse.json({ error: 'Save order details before previewing offers' }, { status: 409 });
    }
    const updated = await recordFunnelDecision(storeConfig, session, stepId, decision, { preview });
    let reachedThankYou = false;
    if (updated.currentStepId && updated.currentStepId !== stepId) {
      const nextStep = sessionFunnelStep(storeConfig, updated);
      reachedThankYou = nextStep?.type === 'thank_you';
      if (nextStep?.type === 'thank_you' && updated.primaryPaymentStatus === 'paid') {
        const finalized = await finalizeCheckoutSession(session.id, storeConfig, { force: true });
        return NextResponse.json({ ok: true, nextStepId: nextStep.id, completed: true, orderNumber: finalized.order_number });
      }
    }
    return NextResponse.json({
      ok: true,
      nextStepId: updated.currentStepId,
      completed: false,
      previewComplete: preview && reachedThankYou,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to record funnel decision' }, { status: 400 });
  }
}
