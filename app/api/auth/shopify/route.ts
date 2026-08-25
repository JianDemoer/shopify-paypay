import { NextRequest } from 'next/server';
import { redirect } from 'next/navigation';
import { createShopifyOAuthState, normalizeShopDomain, requestedShopifyScopes, shopifyOAuthConfig } from '@/lib/shopify-oauth';

export async function GET(request: NextRequest) {
  let authorizationUrl = '';
  try {
    const shop = normalizeShopDomain(request.nextUrl.searchParams.get('shop'));
    if (!shop) return new Response('A valid shop=store.myshopify.com parameter is required.', { status: 400 });
    const config = shopifyOAuthConfig();
    const url = new URL(`https://${shop}/admin/oauth/authorize`);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('scope', requestedShopifyScopes());
    url.searchParams.set('redirect_uri', config.redirectUri);
    url.searchParams.set('state', createShopifyOAuthState(shop));
    authorizationUrl = url.toString();
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Shopify installation is not configured.', { status: 500 });
  }
  redirect(authorizationUrl);
}
