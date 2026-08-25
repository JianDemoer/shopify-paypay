import crypto from 'crypto';
import { isProductionRuntime } from './runtime';

export function verifyAppProxySearchParams(
  searchParams: Record<string, string | string[] | undefined>,
  secret = process.env.SHOPIFY_APP_PROXY_SECRET || process.env.SHOPIFY_API_SECRET || ''
) {
  if (!secret) return !isProductionRuntime();

  const signature = stringValue(searchParams.signature);
  if (!signature) return false;

  const sortedPairs = Object.entries(searchParams)
    .filter(([key]) => key !== 'signature')
    .flatMap(([key, value]) => {
      if (Array.isArray(value)) {
        return value.map((item) => `${key}=${item}`);
      }
      return [`${key}=${value ?? ''}`];
    })
    .sort();

  const message = sortedPairs.join('');
  const digest = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');

  return safeCompare(digest, signature);
}

function stringValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
