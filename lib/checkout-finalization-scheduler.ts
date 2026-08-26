const DEFAULT_GRACE_SECONDS = 15 * 60;

export function checkoutFinalizationDeadline(now = Date.now()) {
  const configured = Number(process.env.CHECKOUT_FINALIZATION_GRACE_SECONDS);
  const graceSeconds = Number.isFinite(configured)
    ? Math.min(60 * 60, Math.max(60, Math.floor(configured)))
    : DEFAULT_GRACE_SECONDS;
  return new Date(now + graceSeconds * 1000).toISOString();
}

export async function scheduleCheckoutFinalization(sessionId: string, finalizeAfter: string) {
  const token = process.env.QSTASH_TOKEN?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  const appUrl = (process.env.SHOPIFY_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '');
  if (!token || !cronSecret || !appUrl) return false;

  const destination = new URL('/api/cron/finalize-checkouts', appUrl);
  destination.searchParams.set('session_id', sessionId);
  const scheduledAt = new Date(finalizeAfter).getTime();
  if (!Number.isFinite(scheduledAt)) throw new Error('Invalid checkout finalization deadline');
  const delaySeconds = Math.max(1, Math.ceil((scheduledAt - Date.now()) / 1000));
  const deduplicationId = `finalize-${sessionId}-${Math.floor(scheduledAt / 1000)}`.slice(0, 128);
  const response = await fetch(`https://qstash.upstash.io/v2/publish/${encodeURIComponent(destination.toString())}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Upstash-Delay': `${delaySeconds}s`,
      'Upstash-Retries': '5',
      'Upstash-Deduplication-Id': deduplicationId,
      'Upstash-Forward-Authorization': `Bearer ${cronSecret}`,
    },
    body: JSON.stringify({ sessionId }),
  });
  if (!response.ok) throw new Error(`QStash finalization scheduling failed: ${response.status}`);
  return true;
}

export async function scheduleCheckoutFinalizationSafely(sessionId: string, finalizeAfter: string) {
  try {
    return await scheduleCheckoutFinalization(sessionId, finalizeAfter);
  } catch (error) {
    console.error('Checkout finalization scheduling failed:', error);
    return false;
  }
}
