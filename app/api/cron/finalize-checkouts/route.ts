import { NextRequest, NextResponse } from 'next/server';
import { finalizeCheckoutSession } from '@/lib/order-finalization';
import { listCheckoutSessions } from '@/lib/checkout-sessions';
import { listStoreConfigs } from '@/lib/store-configs';

function authorized(request: NextRequest) {
  const expected = process.env.CRON_SECRET || '';
  if (!expected) return process.env.NODE_ENV !== 'production';
  const authorization = request.headers.get('authorization') || '';
  return authorization === `Bearer ${expected}`;
}

async function finalizeDueCheckouts(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const configs = await listStoreConfigs();
  const configMap = new Map(configs.map((config) => [config.id, config]));
  const now = Date.now();
  const requestedSessionId = request.nextUrl.searchParams.get('session_id') || '';
  const candidates = (await listCheckoutSessions()).filter((session) => {
    if (requestedSessionId && session.id !== requestedSessionId) return false;
    return session.primaryPaymentStatus === 'paid'
      && session.finalizationStatus !== 'completed'
      && session.finalizeAfter
      && new Date(session.finalizeAfter).getTime() <= now;
  });
  const results: Array<{ sessionId: string; orderNumber?: number; error?: string }> = [];
  for (const session of candidates.slice(0, 50)) {
    const config = configMap.get(session.storeId);
    if (!config) {
      results.push({ sessionId: session.id, error: 'Store configuration not found' });
      continue;
    }
    try {
      const order = await finalizeCheckoutSession(session.id, config, { force: true });
      results.push({ sessionId: session.id, orderNumber: order.order_number });
    } catch (error) {
      results.push({ sessionId: session.id, error: error instanceof Error ? error.message : 'Finalization failed' });
    }
  }
  return NextResponse.json({ processed: results.length, results });
}

export async function GET(request: NextRequest) {
  return finalizeDueCheckouts(request);
}

export async function POST(request: NextRequest) {
  return finalizeDueCheckouts(request);
}
