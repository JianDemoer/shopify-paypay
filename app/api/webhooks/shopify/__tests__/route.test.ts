import crypto from 'crypto';
import { POST } from '../route';
import { revokeShopifyInstallation } from '@/lib/store-configs';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (_body: unknown, init?: { status?: number }) => ({ status: init?.status || 200 }),
  },
}));

jest.mock('@/lib/shopify-oauth', () => ({
  shopifyClientSecrets: jest.fn(() => ['webhook-test-secret']),
}));

jest.mock('@/lib/store-configs', () => ({
  revokeShopifyInstallation: jest.fn().mockResolvedValue(true),
}));

describe('Shopify uninstall webhook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('revokes the OAuth connection without deleting the merchant configuration', async () => {
    const body = JSON.stringify({ id: 123 });
    const signature = crypto.createHmac('sha256', 'webhook-test-secret').update(body, 'utf8').digest('base64');
    const request = mockRequest(body, {
      'x-shopify-hmac-sha256': signature,
      'x-shopify-topic': 'app/uninstalled',
      'x-shopify-shop-domain': 'installed.myshopify.com',
    });

    const response = await POST(request as never);

    expect(response.status).toBe(200);
    expect(revokeShopifyInstallation).toHaveBeenCalledWith('installed.myshopify.com');
  });

  it('rejects an invalid webhook signature before changing any store state', async () => {
    const request = mockRequest('{}', {
      'x-shopify-hmac-sha256': 'invalid',
      'x-shopify-topic': 'app/uninstalled',
      'x-shopify-shop-domain': 'installed.myshopify.com',
    });

    const response = await POST(request as never);

    expect(response.status).toBe(401);
    expect(revokeShopifyInstallation).not.toHaveBeenCalled();
  });
});

function mockRequest(body: string, values: Record<string, string>) {
  return {
    headers: { get: (name: string) => values[name.toLowerCase()] || null },
    text: async () => body,
  };
}
