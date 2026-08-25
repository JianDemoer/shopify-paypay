import crypto from 'crypto';
import { createShopifyOAuthState, normalizeShopDomain, verifyShopifyCallbackHmac, verifyShopifyOAuthState } from '../shopify-oauth';

describe('Shopify OAuth helpers', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('normalizes only myshopify shop domains', () => {
    expect(normalizeShopDomain('https://Demo-Store.myshopify.com/')).toBe('demo-store.myshopify.com');
    expect(normalizeShopDomain('https://example.com')).toBe('');
  });

  it('signs and verifies expiring install state', () => {
    const now = Date.parse('2026-08-25T00:00:00.000Z');
    const state = createShopifyOAuthState('demo-store.myshopify.com', now);
    expect(verifyShopifyOAuthState(state, 'demo-store.myshopify.com', now)).toBe(true);
    expect(verifyShopifyOAuthState(state, 'other-store.myshopify.com', now)).toBe(false);
    expect(verifyShopifyOAuthState(state, 'demo-store.myshopify.com', now + 11 * 60 * 1000)).toBe(false);
    expect(verifyShopifyOAuthState(`${state}x`, 'demo-store.myshopify.com', now)).toBe(false);
  });

  it('verifies callback HMACs and install state during client secret rotation', () => {
    const previousSecret = 'previous-secret';
    process.env.SHOPIFY_API_SECRET = previousSecret;
    const now = Date.parse('2026-08-25T00:00:00.000Z');
    const state = createShopifyOAuthState('demo-store.myshopify.com', now);
    const params = new URLSearchParams({ code: 'oauth-code', shop: 'demo-store.myshopify.com', state, timestamp: '1787616000' });
    const message = [...params.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join('&');
    params.set('hmac', crypto.createHmac('sha256', previousSecret).update(message).digest('hex'));

    process.env.SHOPIFY_API_SECRET = 'new-secret';
    process.env.SHOPIFY_API_SECRET_PREVIOUS = previousSecret;
    expect(verifyShopifyCallbackHmac(params)).toBe(true);
    expect(verifyShopifyOAuthState(state, 'demo-store.myshopify.com', now)).toBe(true);
  });
});
