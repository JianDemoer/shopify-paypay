import { adminMutationAccessForRequest, createAdminSession, verifyAdminSession } from '../admin-auth';

describe('admin sessions', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('creates a store-scoped expiring session', () => {
    process.env.ADMIN_SESSION_SECRET = 'session-secret';
    const now = Date.parse('2026-08-25T00:00:00.000Z');
    const session = createAdminSession('demo.myshopify.com', now);
    expect(verifyAdminSession(session, now)).toBe('demo.myshopify.com');
    expect(verifyAdminSession(session, now + 9 * 60 * 60 * 1000)).toBe('');
  });

  it('rejects a session signed with another admin secret', () => {
    process.env.ADMIN_SESSION_SECRET = 'first-secret';
    const session = createAdminSession('demo.myshopify.com');
    process.env.ADMIN_SESSION_SECRET = 'second-secret';
    expect(verifyAdminSession(session)).toBe('');
  });

  it('requires a same-origin request before a shop session can mutate configuration', () => {
    process.env.ADMIN_SESSION_SECRET = 'session-secret';
    const session = createAdminSession('demo.myshopify.com');
    const request = (origin?: string) => ({
      headers: new Headers(origin ? { origin } : {}),
      nextUrl: new URL('https://app.example.com/api/admin/stores'),
      cookies: { get: () => ({ value: session }) },
    }) as never;

    expect(adminMutationAccessForRequest(request('https://app.example.com'))).toEqual({
      kind: 'shop',
      shopDomain: 'demo.myshopify.com',
    });
    expect(adminMutationAccessForRequest(request('https://attacker.example'))).toBeNull();
    expect(adminMutationAccessForRequest(request())).toBeNull();
  });

  it('keeps the global admin token separate from merchant sessions', () => {
    process.env.ADMIN_CONFIG_TOKEN = 'global-token';
    process.env.ADMIN_SESSION_SECRET = 'session-secret';
    const session = createAdminSession('demo.myshopify.com');
    process.env.ADMIN_CONFIG_TOKEN = 'rotated-global-token';
    expect(verifyAdminSession(session)).toBe('demo.myshopify.com');
  });
});
