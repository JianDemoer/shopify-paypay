import { upstashRestConfig } from '../upstash-config';

describe('upstashRestConfig', () => {
  it('prefers the native Upstash REST variables', () => {
    expect(upstashRestConfig({
      UPSTASH_REDIS_REST_URL: 'https://native.example',
      UPSTASH_REDIS_REST_TOKEN: 'native-token',
      KV_REST_API_URL: 'https://kv.example',
      KV_REST_API_TOKEN: 'kv-token',
    })).toEqual({ url: 'https://native.example', token: 'native-token' });
  });

  it('supports Vercel KV variables', () => {
    expect(upstashRestConfig({
      KV_REST_API_URL: 'https://kv.example',
      KV_REST_API_TOKEN: 'kv-token',
    })).toEqual({ url: 'https://kv.example', token: 'kv-token' });
  });

  it('supports prefixed Vercel Marketplace variables', () => {
    expect(upstashRestConfig({
      UPSTASH_REDIS_REST_KV_REST_API_URL: 'https://marketplace.example',
      UPSTASH_REDIS_REST_KV_REST_API_TOKEN: 'marketplace-token',
    })).toEqual({ url: 'https://marketplace.example', token: 'marketplace-token' });
  });

  it('does not combine values from different variable pairs', () => {
    expect(upstashRestConfig({
      UPSTASH_REDIS_REST_URL: 'https://native.example',
      KV_REST_API_TOKEN: 'kv-token',
    })).toEqual({});
  });
});
