import { NextRequest, NextResponse } from 'next/server';
import { isProductionRuntime } from '@/lib/runtime';
import { getStoreConfig, listStoreConfigs } from '@/lib/store-configs';
import { listCheckoutEvents, summarizeCheckoutEvents } from '@/lib/checkout-events';

function authorized(request: NextRequest) {
  const token = process.env.ADMIN_CONFIG_TOKEN;
  if (!token) return !isProductionRuntime();
  return request.headers.get('x-admin-token') === token;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const storeId = request.nextUrl.searchParams.get('storeId') || undefined;
  if (storeId) await getStoreConfig(storeId);
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  const events = await listCheckoutEvents({ storeId, from, to });
  return NextResponse.json({ range: { from: from.toISOString(), to: to.toISOString() }, summary: summarizeCheckoutEvents(events), stores: (await listStoreConfigs()).map((store) => ({ id: store.id, name: store.name })) });
}
