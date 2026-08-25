import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_SESSION_COOKIE, ADMIN_SESSION_MAX_AGE, createAdminSession } from '@/lib/admin-auth';
import { saveShopifyInstallation } from '@/lib/store-configs';
import { ensureAppUninstalledWebhook } from '@/lib/shopify-webhooks';
import { normalizeShopDomain, requestedShopifyScopes, shopifyOAuthConfig, verifyShopifyCallbackHmac, verifyShopifyOAuthState } from '@/lib/shopify-oauth';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const shop = normalizeShopDomain(params.get('shop'));
  const state = params.get('state') || '';
  if (!shop || !state || !verifyShopifyCallbackHmac(params) || !verifyShopifyOAuthState(state, shop)) return new Response('Invalid Shopify OAuth callback.', { status: 400 });
  const code = params.get('code') || '';
  if (!code) return new Response('Missing Shopify OAuth code.', { status: 400 });
  let appUrl = '';
  try {
    const config = shopifyOAuthConfig();
    appUrl = config.appUrl;
    let token: { access_token?: string; scope?: string } | undefined;
    let tokenStatus = 502;
    for (const clientSecret of config.clientSecrets) {
      const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: config.clientId, client_secret: clientSecret, code }),
        cache: 'no-store',
      });
      tokenStatus = tokenResponse.status;
      if (!tokenResponse.ok) continue;
      token = await tokenResponse.json() as { access_token?: string; scope?: string };
      if (token.access_token) break;
    }
    if (!token?.access_token) return new Response(`Shopify token exchange failed: ${tokenStatus}`, { status: 502 });
    await saveShopifyInstallation({ shopDomain: shop, accessToken: token.access_token, scopes: token.scope || requestedShopifyScopes() });
    try {
      await ensureAppUninstalledWebhook({
        shopDomain: shop,
        accessToken: token.access_token,
        callbackUrl: `${config.appUrl}/api/webhooks/shopify`,
      });
    } catch (error) {
      console.error('Shopify uninstall webhook registration failed:', error);
    }
  } catch (error) {
    console.error('Shopify OAuth callback failed:', error);
    return new Response(error instanceof Error ? error.message : 'Shopify installation failed.', { status: 500 });
  }
  const destination = new URL('/admin/stores', appUrl);
  destination.searchParams.set('shop', shop);
  destination.searchParams.set('installed', '1');
  const response = NextResponse.redirect(destination);
  response.cookies.set(ADMIN_SESSION_COOKIE, createAdminSession(shop), {
    httpOnly: true,
    secure: destination.protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: ADMIN_SESSION_MAX_AGE,
  });
  return response;
}
