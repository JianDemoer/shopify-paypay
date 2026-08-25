import { NextRequest } from 'next/server';
import { redirect } from 'next/navigation';
import { saveShopifyInstallation } from '@/lib/store-configs';
import { normalizeShopDomain, requestedShopifyScopes, shopifyOAuthConfig, verifyShopifyCallbackHmac, verifyShopifyOAuthState } from '@/lib/shopify-oauth';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const shop = normalizeShopDomain(params.get('shop'));
  const state = params.get('state') || '';
  if (!shop || !state || !verifyShopifyCallbackHmac(params) || !verifyShopifyOAuthState(state, shop)) return new Response('Invalid Shopify OAuth callback.', { status: 400 });
  const code = params.get('code') || '';
  if (!code) return new Response('Missing Shopify OAuth code.', { status: 400 });
  try {
    const config = shopifyOAuthConfig();
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code }),
    });
    if (!tokenResponse.ok) return new Response(`Shopify token exchange failed: ${tokenResponse.status}`, { status: 502 });
    const token = await tokenResponse.json() as { access_token?: string; scope?: string };
    if (!token.access_token) return new Response('Shopify did not return an access token.', { status: 502 });
    await saveShopifyInstallation({ shopDomain: shop, accessToken: token.access_token, scopes: token.scope || requestedShopifyScopes() });
  } catch (error) {
    console.error('Shopify OAuth callback failed:', error);
    return new Response(error instanceof Error ? error.message : 'Shopify installation failed.', { status: 500 });
  }
  redirect(`/admin/stores?shop=${encodeURIComponent(shop)}&installed=1`);
}
