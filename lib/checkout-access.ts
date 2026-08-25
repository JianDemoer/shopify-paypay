import crypto from 'crypto';
import { isProductionRuntime } from './runtime';

interface CheckoutAccessPayload {
  sessionId: string;
  cid: string;
  expiresAt: number;
}

function base64UrlEncode(value: string) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signature(payload: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function checkoutAccessSecret(appProxySecret?: string) {
  const secret = appProxySecret || process.env.CHECKOUT_ACCESS_SECRET || '';
  if (!secret && isProductionRuntime()) {
    throw new Error('Checkout access secret is not configured');
  }
  return secret || 'local-development-checkout-secret';
}

export function createCheckoutAccessToken(
  sessionId: string,
  cid: string,
  expiresAt: string,
  appProxySecret?: string
) {
  const payload: CheckoutAccessPayload = {
    sessionId,
    cid,
    expiresAt: Math.floor(new Date(expiresAt).getTime() / 1000),
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${signature(encodedPayload, checkoutAccessSecret(appProxySecret))}`;
}

export function verifyCheckoutAccessToken(
  token: string | undefined,
  sessionId: string,
  appProxySecret?: string
) {
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encodedPayload, providedSignature] = parts;
  if (!encodedPayload || !providedSignature) return null;

  const expectedSignature = signature(encodedPayload, checkoutAccessSecret(appProxySecret));
  const expectedBuffer = Buffer.from(expectedSignature);
  const providedBuffer = Buffer.from(providedSignature);
  if (
    expectedBuffer.length !== providedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as CheckoutAccessPayload;
    if (
      payload.sessionId !== sessionId ||
      !payload.cid ||
      !Number.isFinite(payload.expiresAt) ||
      payload.expiresAt < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
