import { NextRequest, NextResponse } from 'next/server';
import { adminAccessForRequest } from '@/lib/admin-auth';
import { getStoreConfig, listStoreConfigs } from '@/lib/store-configs';
import { listCheckoutEvents, summarizeCheckoutEvents } from '@/lib/checkout-events';

export async function GET(request: NextRequest) {
  const access = adminAccessForRequest(request);
  if (!access) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const requestedStoreId = request.nextUrl.searchParams.get('storeId') || undefined;
  const scopedStore = access.kind === 'shop' ? await getStoreConfig(access.shopDomain) : undefined;
  if (scopedStore && requestedStoreId && requestedStoreId !== scopedStore.id && requestedStoreId !== scopedStore.shopDomain) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const storeId = scopedStore?.id || requestedStoreId;
  if (!scopedStore && storeId) await getStoreConfig(storeId);
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  const events = await listCheckoutEvents({ storeId, from, to });
  const stores = (await listStoreConfigs())
    .filter((store) => access.kind === 'global' || store.shopDomain === access.shopDomain)
    .map((store) => ({ id: store.id, name: store.name }));
  return NextResponse.json({ range: { from: from.toISOString(), to: to.toISOString() }, summary: summarizeCheckoutEvents(events), stores });
}
