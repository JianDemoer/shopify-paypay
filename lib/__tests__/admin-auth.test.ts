import { createAdminSession, verifyAdminSession } from '../admin-auth';

describe('admin sessions', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('creates a store-scoped expiring session', () => {
    process.env.ADMIN_CONFIG_TOKEN = 'admin-secret';
    const now = Date.parse('2026-08-25T00:00:00.000Z');
    const session = createAdminSession('demo.myshopify.com', now);
    expect(verifyAdminSession(session, now)).toBe('demo.myshopify.com');
    expect(verifyAdminSession(session, now + 9 * 60 * 60 * 1000)).toBe('');
  });

  it('rejects a session signed with another admin secret', () => {
    process.env.ADMIN_CONFIG_TOKEN = 'first-secret';
    const session = createAdminSession('demo.myshopify.com');
    process.env.ADMIN_CONFIG_TOKEN = 'second-secret';
    expect(verifyAdminSession(session)).toBe('');
  });
});
