export interface UpstashRestConfig {
  url?: string;
  token?: string;
}

type Environment = Readonly<Record<string, string | undefined>>;

export function upstashRestConfig(env: Environment = process.env): UpstashRestConfig {
  const candidates: Array<[string | undefined, string | undefined]> = [
    [env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN],
    [env.KV_REST_API_URL, env.KV_REST_API_TOKEN],
    [
      env.UPSTASH_REDIS_REST_KV_REST_API_URL,
      env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN,
    ],
  ];

  const configured = candidates.find(([url, token]) => Boolean(url && token));
  return configured ? { url: configured[0], token: configured[1] } : {};
}
