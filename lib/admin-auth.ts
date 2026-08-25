import crypto from 'crypto';
import type { NextRequest } from 'next/server';
import { isProductionRuntime } from './runtime';
import { normalizeShopDomain } from './shopify-oauth';

export const ADMIN_SESSION_COOKIE = 'omni_admin_session';
export const ADMIN_SESSION_MAX_AGE = 8 * 60 * 60;

export type AdminAccess =
  | { kind: 'global' }
  | { kind: 'shop'; shopDomain: string };

function configuredSecret() {
  return process.env.ADMIN_CONFIG_TOKEN?.trim() || '';
}

function signature(value: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function createAdminSession(shopDomain: string, now = Date.now()) {
  const secret = configuredSecret();
  const shop = normalizeShopDomain(shopDomain);
  if (!secret || !shop) throw new Error('Admin session is not configured');
  const payload = Buffer.from(JSON.stringify({
    shop,
    exp: Math.floor(now / 1000) + ADMIN_SESSION_MAX_AGE,
    nonce: crypto.randomBytes(16).toString('hex'),
  })).toString('base64url');
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyAdminSession(value: string | undefined, now = Date.now()) {
  const secret = configuredSecret();
  const [payload, provided] = String(value || '').split('.');
  if (!secret || !payload || !provided || !safeEqual(signature(payload, secret), provided)) return '';
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { shop?: string; exp?: number; nonce?: string };
    const shop = normalizeShopDomain(decoded.shop);
    return shop && decoded.nonce && Number(decoded.exp) >= Math.floor(now / 1000) ? shop : '';
  } catch {
    return '';
  }
}

export function adminAccessForRequest(request: NextRequest): AdminAccess | null {
  const secret = configuredSecret();
  if (!secret) return isProductionRuntime() ? null : { kind: 'global' };
  const headerToken = request.headers.get('x-admin-token') || '';
  if (headerToken && safeEqual(headerToken, secret)) return { kind: 'global' };
  const shopDomain = verifyAdminSession(request.cookies.get(ADMIN_SESSION_COOKIE)?.value);
  return shopDomain ? { kind: 'shop', shopDomain } : null;
}
