jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  mkdir: jest.fn(),
  rename: jest.fn(),
  writeFile: jest.fn(),
}));

import { readFile } from 'fs/promises';
import { getStoreConfig } from '../store-configs';

describe('store configuration selection', () => {
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
});
