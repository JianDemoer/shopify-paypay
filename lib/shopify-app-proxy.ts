import crypto from 'crypto';
import { isProductionRuntime } from './runtime';
import { shopifyClientSecrets } from './shopify-oauth';

export function verifyAppProxySearchParams(
  searchParams: Record<string, string | string[] | undefined>,
  secret = process.env.SHOPIFY_APP_PROXY_SECRET || process.env.SHOPIFY_API_SECRET || ''
) {
  const secrets = [...new Set([
    secret,
    process.env.SHOPIFY_APP_PROXY_SECRET,
    process.env.SHOPIFY_APP_PROXY_SECRET_PREVIOUS,
    ...shopifyClientSecrets(),
  ].map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
  if (secrets.length === 0) return !isProductionRuntime();

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
  return secrets.some((key) => {
    const digest = crypto
      .createHmac('sha256', key)
      .update(message)
      .digest('hex');
    return safeCompare(digest, signature);
  });
}

function stringValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
