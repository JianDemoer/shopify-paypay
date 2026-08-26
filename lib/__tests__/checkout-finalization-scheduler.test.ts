import { checkoutFinalizationDeadline, scheduleCheckoutFinalization } from '../checkout-finalization-scheduler';

describe('checkout finalization scheduling', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('creates a bounded finalization deadline', () => {
    process.env.CHECKOUT_FINALIZATION_GRACE_SECONDS = '10';
    expect(checkoutFinalizationDeadline(0)).toBe('1970-01-01T00:01:00.000Z');
    process.env.CHECKOUT_FINALIZATION_GRACE_SECONDS = '7200';
    expect(checkoutFinalizationDeadline(0)).toBe('1970-01-01T01:00:00.000Z');
  });

  it('publishes an authenticated delayed QStash job', async () => {
    process.env.QSTASH_TOKEN = 'qstash-token';
    process.env.CRON_SECRET = 'cron-secret';
    process.env.SHOPIFY_APP_URL = 'https://app.example.com';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch;
    const deadline = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    await expect(scheduleCheckoutFinalization('session-1', deadline)).resolves.toBe(true);

    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toContain('qstash.upstash.io/v2/publish/');
    expect(decodeURIComponent(String(url))).toContain('https://app.example.com/api/cron/finalize-checkouts?session_id=session-1');
    expect(options.headers).toEqual(expect.objectContaining({
      Authorization: 'Bearer qstash-token',
      'Upstash-Forward-Authorization': 'Bearer cron-secret',
    }));
  });

  it('is disabled when QStash is not configured', async () => {
    delete process.env.QSTASH_TOKEN;
    await expect(scheduleCheckoutFinalization('session-1', new Date().toISOString())).resolves.toBe(false);
  });
});
