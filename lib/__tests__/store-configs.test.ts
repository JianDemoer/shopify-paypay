jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  mkdir: jest.fn(),
  rename: jest.fn(),
  writeFile: jest.fn(),
}));

import crypto from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import { getStoreConfig, revokeShopifyInstallation, saveStoreConfig } from '../store-configs';

describe('store configuration selection', () => {
  const originalEncryptionKey = process.env.CONFIG_ENCRYPTION_KEY;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CONFIG_ENCRYPTION_KEY = 'store-config-test-key';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    if (originalEncryptionKey === undefined) delete process.env.CONFIG_ENCRYPTION_KEY;
    else process.env.CONFIG_ENCRYPTION_KEY = originalEncryptionKey;
  });

  it('allows an installed Shopify store to use the non-payment workflow without Stripe keys', async () => {
    process.env.SHOPIFY_STORE_DOMAIN = 'installed.myshopify.com';
    process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = 'shopify-admin-token';
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    (readFile as jest.Mock).mockRejectedValueOnce({ code: 'ENOENT' });

    await expect(getStoreConfig('installed.myshopify.com')).resolves.toMatchObject({
      shopDomain: 'installed.myshopify.com',
      shopifyAdminAccessToken: 'shopify-admin-token',
      stripeSecretKey: '',
      stripePublishableKey: '',
    });
  });

  it('does not fall back to the first store for an unknown identifier', async () => {
    (readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify([
      { id: 'first.myshopify.com', shopDomain: 'first.myshopify.com' },
      { id: 'second.myshopify.com', shopDomain: 'second.myshopify.com' },
    ]));

    await expect(getStoreConfig('unknown.myshopify.com')).rejects.toThrow('Unknown store configuration');
  });

  it('requires an identifier when multiple stores are configured', async () => {
    (readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify([
      { id: 'first.myshopify.com', shopDomain: 'first.myshopify.com' },
      { id: 'second.myshopify.com', shopDomain: 'second.myshopify.com' },
    ]));

    await expect(getStoreConfig()).rejects.toThrow('Store identifier is required');
  });

  it('only permits business configuration for a store created by Shopify OAuth', async () => {
    (readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify([]));

    await expect(saveStoreConfig({
      shopDomain: 'not-installed.myshopify.com',
      shopifyAdminAccessToken: 'injected-token',
    })).rejects.toThrow('Install the Shopify app before editing a store');
  });

  it('does not allow a configuration request to replace Shopify OAuth credentials', async () => {
    (readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify([{
      id: 'installed.myshopify.com',
      name: 'Installed',
      shopDomain: 'installed.myshopify.com',
      currency: 'USD',
      shopifyAdminAccessToken: 'oauth-token',
      shopifyAppProxySecret: 'app-secret',
      shopifyScopes: 'read_products',
      stripeSecretKey: 'old-stripe-secret',
      orderMode: 'draft_order',
      standardShipping: 3.99,
      expressShipping: 5.99,
      taxRate: 0,
    }]));

    const updated = await saveStoreConfig({
      id: 'installed.myshopify.com',
      shopDomain: 'installed.myshopify.com',
      name: 'Business settings only',
      shopifyAdminAccessToken: 'attacker-token',
      shopifyAppProxySecret: 'attacker-secret',
      shopifyScopes: 'write_orders',
      stripeSecretKey: 'new-stripe-secret',
    });

    expect(updated.name).toBe('Business settings only');
    expect(updated.stripeSecretKey).toBe('new-stripe-secret');
    expect(updated.shopifyAdminAccessToken).toBe('oauth-token');
    expect(updated.shopifyAppProxySecret).toBe('app-secret');
    expect(updated.shopifyScopes).toBe('read_products');
  });

  it('revokes OAuth credentials on uninstall but preserves merchant checkout settings', async () => {
    (readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify([{
      id: 'installed.myshopify.com',
      name: 'Installed',
      shopDomain: 'installed.myshopify.com',
      currency: 'USD',
      storefrontAccessToken: 'storefront-token',
      shopifyAdminAccessToken: 'oauth-token',
      shopifyAppProxySecret: 'app-secret',
      shopifyScopes: 'read_products',
      stripeSecretKey: 'stripe-secret',
      orderMode: 'draft_order',
      standardShipping: 3.99,
      expressShipping: 5.99,
      taxRate: 0,
    }]));

    await expect(revokeShopifyInstallation('installed.myshopify.com')).resolves.toBe(true);
    const serialized = (writeFile as jest.Mock).mock.calls[0][1] as string;
    const encrypted = JSON.parse(serialized) as { iv: string; tag: string; data: string };
    const key = crypto.createHash('sha256').update('store-config-test-key').digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64url'));
    const saved = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted.data, 'base64url')), decipher.final()]).toString('utf8'))[0];

    expect(saved).toMatchObject({
      stripeSecretKey: 'stripe-secret',
      orderMode: 'draft_order',
      shopifyAdminAccessToken: '',
      shopifyAppProxySecret: '',
      shopifyScopes: '',
      storefrontAccessToken: '',
    });
  });
});
