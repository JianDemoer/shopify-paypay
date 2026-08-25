import crypto from 'crypto';

export function shopifyClientSecrets(additional: Array<string | undefined> = []) {
  return [...new Set([
    ...additional,
    process.env.SHOPIFY_API_SECRET,
    process.env.SHOPIFY_CLIENT_SECRET,
    process.env.SHOPIFY_API_SECRET_PREVIOUS,
    process.env.SHOPIFY_CLIENT_SECRET_PREVIOUS,
  ].map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function secret() {
  return shopifyClientSecrets()[0] || process.env.CONFIG_ENCRYPTION_KEY || 'local-shopify-oauth-secret';
}

function stateSecrets() {
  const secrets = shopifyClientSecrets();
  return secrets.length > 0 ? secrets : [secret()];
}

function sign(value: string, key = secret()) {
  return crypto.createHmac('sha256', key).update(value).digest('base64url');
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function validShop(value: string) {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(value);
}

export function normalizeShopDomain(value: unknown) {
  const shop = String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  return validShop(shop) ? shop : '';
}

export function createShopifyOAuthState(shop: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ shop, exp: Math.floor(now / 1000) + 10 * 60, nonce: crypto.randomBytes(16).toString('hex') })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyShopifyOAuthState(state: string, expectedShop: string, now = Date.now()) {
  const [payload, provided] = String(state || '').split('.');
  if (!payload || !provided) return false;
  if (!stateSecrets().some((key) => safeEqual(sign(payload, key), provided))) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { shop?: string; exp?: number; nonce?: string };
    return decoded.shop === expectedShop && Boolean(decoded.nonce) && Number(decoded.exp) >= Math.floor(now / 1000);
  } catch {
    return false;
  }
}

export function verifyShopifyCallbackHmac(searchParams: URLSearchParams) {
  const provided = searchParams.get('hmac') || '';
  if (!provided) return false;
  const message = [...searchParams.entries()]
    .filter(([key]) => key !== 'hmac' && key !== 'signature')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return stateSecrets().some((key) => {
    const expected = crypto.createHmac('sha256', key).update(message).digest('hex');
    return safeEqual(expected, provided);
  });
}

export function shopifyOAuthConfig() {
  const clientId = process.env.SHOPIFY_API_KEY || process.env.SHOPIFY_CLIENT_ID || '';
  const clientSecret = process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_CLIENT_SECRET || '';
  const appUrl = (process.env.SHOPIFY_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '');
  const redirectUri = process.env.SHOPIFY_OAUTH_REDIRECT_URI || `${appUrl}/api/auth/shopify/callback`;
  if (!clientId || !clientSecret || !appUrl) throw new Error('SHOPIFY_API_KEY, SHOPIFY_API_SECRET, and SHOPIFY_APP_URL are required');
  return { clientId, clientSecret, clientSecrets: shopifyClientSecrets(), appUrl, redirectUri };
}

export function requestedShopifyScopes() {
  return process.env.SHOPIFY_API_SCOPES || 'read_products,read_orders,write_orders,write_draft_orders';
}
