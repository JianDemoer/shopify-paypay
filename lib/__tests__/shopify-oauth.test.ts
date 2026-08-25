import { createShopifyOAuthState, normalizeShopDomain, verifyShopifyOAuthState } from '../shopify-oauth';

describe('Shopify OAuth helpers', () => {
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
});
