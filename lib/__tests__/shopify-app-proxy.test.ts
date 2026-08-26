import crypto from 'crypto';
import { verifyAppProxySearchParams } from '../shopify-app-proxy';

describe('Shopify App Proxy signatures', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('accepts a signature made with the previous client secret', () => {
    process.env.SHOPIFY_API_SECRET = 'new-secret';
    process.env.SHOPIFY_API_SECRET_PREVIOUS = 'previous-secret';
    const params = { path_prefix: '/a/s', shop: 'demo.myshopify.com', timestamp: '1787616000' };
    const message = Object.entries(params).map(([key, value]) => `${key}=${value}`).sort().join('');
    const signature = crypto.createHmac('sha256', 'previous-secret').update(message).digest('hex');

    expect(verifyAppProxySearchParams({ ...params, signature }, 'new-secret')).toBe(true);
  });

  it('rejects replayed proxy URLs in production', () => {
    process.env.VERCEL_ENV = 'production';
    const secret = 'proxy-secret';
    const now = Date.parse('2026-08-26T12:00:00.000Z');
    const params = { path_prefix: '/a/s', shop: 'demo.myshopify.com', timestamp: String(Math.floor(now / 1000) - 301) };
    const message = Object.entries(params).map(([key, value]) => `${key}=${value}`).sort().join('');
    const signature = crypto.createHmac('sha256', secret).update(message).digest('hex');

    expect(verifyAppProxySearchParams({ ...params, signature }, secret, now)).toBe(false);
  });

  it('accepts a fresh proxy URL in production', () => {
    process.env.VERCEL_ENV = 'production';
    const secret = 'proxy-secret';
    const now = Date.parse('2026-08-26T12:00:00.000Z');
    const params = { path_prefix: '/a/s', shop: 'demo.myshopify.com', timestamp: String(Math.floor(now / 1000)) };
    const message = Object.entries(params).map(([key, value]) => `${key}=${value}`).sort().join('');
    const signature = crypto.createHmac('sha256', secret).update(message).digest('hex');

    expect(verifyAppProxySearchParams({ ...params, signature }, secret, now)).toBe(true);
  });
});
