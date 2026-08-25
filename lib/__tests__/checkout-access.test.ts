import {
  createCheckoutAccessToken,
  verifyCheckoutAccessToken,
} from '../checkout-access';

describe('checkout access tokens', () => {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();

  it('accepts a token bound to the session and secret', () => {
    const token = createCheckoutAccessToken('session-1', 'cid-1', expiresAt, 'test-secret');

    expect(verifyCheckoutAccessToken(token, 'session-1', 'test-secret')).toMatchObject({
      sessionId: 'session-1',
      cid: 'cid-1',
    });
  });

  it('rejects a token with a changed payload or session', () => {
    const token = createCheckoutAccessToken('session-1', 'cid-1', expiresAt, 'test-secret');
    const [payload, signature] = token.split('.');
    const tampered = `${payload.slice(0, -1)}${payload.endsWith('a') ? 'b' : 'a'}.${signature}`;

    expect(verifyCheckoutAccessToken(tampered, 'session-1', 'test-secret')).toBeNull();
    expect(verifyCheckoutAccessToken(`${token}.extra`, 'session-1', 'test-secret')).toBeNull();
    expect(verifyCheckoutAccessToken(token, 'session-2', 'test-secret')).toBeNull();
    expect(verifyCheckoutAccessToken(token, 'session-1', 'wrong-secret')).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = createCheckoutAccessToken(
      'session-1',
      'cid-1',
      new Date(Date.now() - 60_000).toISOString(),
      'test-secret'
    );

    expect(verifyCheckoutAccessToken(token, 'session-1', 'test-secret')).toBeNull();
  });
});
