import { NextRequest, NextResponse } from 'next/server';
import { getStoreConfig } from '@/lib/store-configs';
import { getCheckoutSession } from '@/lib/checkout-sessions';
import { verifyCheckoutAccessToken } from '@/lib/checkout-access';
import { recordFunnelDecision } from '@/lib/funnel-progress';
import { finalizeCheckoutSession } from '@/lib/order-finalization';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sessionId = String(body.checkoutSessionId || '');
    const stepId = String(body.stepId || '');
    const decision = body.decision === 'accepted' || body.decision === 'declined' ? body.decision : '';
    if (!sessionId || !stepId || !decision) return NextResponse.json({ error: 'Invalid funnel decision' }, { status: 400 });
    const session = await getCheckoutSession(sessionId);
    if (!session) return NextResponse.json({ error: 'Checkout session not found' }, { status: 404 });
    const storeConfig = await getStoreConfig(session.storeId);
    if (!verifyCheckoutAccessToken(new URL(request.url).searchParams.get('checkout_token') || undefined, session.id, storeConfig.shopifyAppProxySecret)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const updated = await recordFunnelDecision(storeConfig, session, stepId, decision);
    if (updated.currentStepId && updated.currentStepId !== stepId) {
      const currentVersion = storeConfig.funnels?.find((funnel) => funnel.id === updated.funnelId)?.versions.find((version) => version.id === updated.funnelVersionId);
      const nextStep = currentVersion?.steps.find((step) => step.id === updated.currentStepId);
      if (nextStep?.type === 'thank_you') {
        const finalized = await finalizeCheckoutSession(session.id, storeConfig, { force: true });
        return NextResponse.json({ ok: true, nextStepId: nextStep.id, completed: true, orderNumber: finalized.order_number });
      }
    }
    return NextResponse.json({ ok: true, nextStepId: updated.currentStepId, completed: false });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to record funnel decision' }, { status: 400 });
  }
}
