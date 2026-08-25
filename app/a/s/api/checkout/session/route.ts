import { NextRequest, NextResponse } from 'next/server';
import { createCheckoutSession, normalizeCheckoutCid } from '@/lib/checkout-sessions';
import { createCheckoutAccessToken } from '@/lib/checkout-access';
import { verifyAppProxySearchParams } from '@/lib/shopify-app-proxy';
import { getStoreConfig } from '@/lib/store-configs';
import { resolveCheckoutLineItems } from '@/lib/shopify-admin';
import { isProductionRuntime } from '@/lib/runtime';
import { consumeRateLimit } from '@/lib/rate-limit';
import { selectFunnel } from '@/lib/funnel-configs';
import { recordCheckoutEvent } from '@/lib/checkout-events';

function requestCountry(request: NextRequest) {
  return request.headers.get('x-vercel-ip-country')
    || request.headers.get('cf-ipcountry')
    || request.headers.get('x-shopify-country')
    || '';
}

function shopifyCartUrl(shopDomain: string, items: Array<{ variantId: string; quantity: number }>) {
  const lines = items.map((item) => `${item.variantId.split('/').pop()}:${item.quantity}`).join(',');
  return `https://${shopDomain}/cart/${lines}?checkout`;
}

export async function POST(request: NextRequest) {
  try {
    const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const rateLimit = await consumeRateLimit(request, 'app-proxy-checkout-session', 60);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many checkout attempts. Please try again shortly.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
      );
    }
    const body = await request.json();
    const shop = request.nextUrl.searchParams.get('shop');
    if (isProductionRuntime() && !shop) {
      return NextResponse.json({ error: 'Missing Shopify app proxy shop parameter' }, { status: 400 });
    }
    const requestedStore = shop || body.storeId || body.shopDomain || body.shop;
    const storeConfig = await getStoreConfig(requestedStore);
    if (!verifyAppProxySearchParams(searchParams, storeConfig.shopifyAppProxySecret)) {
      return NextResponse.json({ error: 'Invalid app proxy signature' }, { status: 401 });
    }

    const items = await resolveCheckoutLineItems(storeConfig, body);
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const cid = normalizeCheckoutCid(body.cid);
    const funnelSelection = selectFunnel({
      zones: storeConfig.checkoutZones,
      funnels: storeConfig.funnels,
      cid,
      country: requestCountry(request),
      currency: storeConfig.currency,
      utmSource: body.utm?.source || body.utm_source,
      permalinkRouteId: body.routeId || request.nextUrl.searchParams.get('route') || undefined,
    });
    const session = await createCheckoutSession({
      storeId: storeConfig.id,
      shopDomain: storeConfig.shopDomain,
      currency: storeConfig.currency,
      shipping: storeConfig.standardShipping,
      tax: Number((subtotal * storeConfig.taxRate).toFixed(2)),
      cid,
      utm: body.utm,
      funnelSelection,
    }, items);
    await recordCheckoutEvent({
      type: 'checkout_started',
      storeId: session.storeId,
      sessionId: session.id,
      cid: session.cid,
      funnelId: session.funnelId,
      routeId: session.routeId,
      funnelVersionId: session.funnelVersionId,
      value: session.total,
      currency: session.currency,
      properties: { item_count: items.length, checkout_mode: session.checkoutMode || 'three_step' },
    }).catch((error) => console.error('Checkout start event failed:', error));
    const checkoutToken = createCheckoutAccessToken(
      session.id,
      session.cid,
      session.accessExpiresAt || session.expiresAt,
      storeConfig.shopifyAppProxySecret
    );

    const redirectUrl = funnelSelection.checkoutMode === 'shopify'
      ? shopifyCartUrl(storeConfig.shopDomain, items)
      : `/a/s/checkout/${encodeURIComponent(session.id)}/entry?cid=${encodeURIComponent(session.cid)}&checkout_token=${encodeURIComponent(checkoutToken)}`;
    return NextResponse.json({
      sessionId: session.id,
      cid: session.cid,
      routeId: funnelSelection.routeId,
      checkoutMode: funnelSelection.checkoutMode,
      redirectUrl,
    });
  } catch (error) {
    console.error('App proxy checkout session creation failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create checkout session' },
      { status: 400 }
    );
  }
}
