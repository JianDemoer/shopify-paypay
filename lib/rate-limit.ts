import crypto from 'crypto';
import { isProductionRuntime } from './runtime';

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

interface RateLimitResult {
  allowed: boolean;
  retryAfter: number;
}

async function command(command: unknown[]) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  const response = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error(`Upstash rate limit error: ${response.status}`);
  return response.json();
}

function clientKey(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || 'unknown';
}

export async function consumeRateLimit(
  request: Request,
  scope: string,
  limit = 30,
  windowSeconds = 60
): Promise<RateLimitResult> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    if (isProductionRuntime()) throw new Error('Upstash Redis is required for production rate limiting');
    return { allowed: true, retryAfter: 0 };
  }

  const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
  const identity = crypto.createHash('sha256').update(`${scope}:${clientKey(request)}`).digest('hex').slice(0, 32);
  const key = `rate_limit:${scope}:${identity}:${bucket}`;
  const result = await command(['INCR', key]);
  const count = Number(result?.result);
  if (!Number.isFinite(count)) throw new Error('Invalid rate limit response');
  if (count === 1) await command(['EXPIRE', key, windowSeconds]);

  return {
    allowed: count <= limit,
    retryAfter: Math.max(1, (bucket + 1) * windowSeconds - Math.floor(Date.now() / 1000)),
  };
}
