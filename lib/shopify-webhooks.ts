type ShopifyGraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

type WebhookQueryData = {
  webhookSubscriptions?: {
    nodes?: Array<{ uri?: string }>;
  };
};

type WebhookMutationData = {
  webhookSubscriptionCreate?: {
    webhookSubscription?: { id?: string };
    userErrors?: Array<{ message?: string }>;
  };
};

async function shopifyGraphql<T>(shopDomain: string, accessToken: string, query: string, variables?: Record<string, unknown>) {
  const version = process.env.SHOPIFY_ADMIN_API_VERSION || '2026-07';
  const response = await fetch(`https://${shopDomain}/admin/api/${version}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Shopify webhook API failed: ${response.status}`);
  const payload = await response.json() as ShopifyGraphqlResponse<T>;
  if (payload.errors?.length) throw new Error(payload.errors.map((error) => error.message || 'Unknown Shopify GraphQL error').join('; '));
  if (!payload.data) throw new Error('Shopify webhook API returned no data');
  return payload.data;
}

export async function ensureAppUninstalledWebhook(input: {
  shopDomain: string;
  accessToken: string;
  callbackUrl: string;
}) {
  const existing = await shopifyGraphql<WebhookQueryData>(
    input.shopDomain,
    input.accessToken,
    `query AppUninstalledWebhooks {
      webhookSubscriptions(first: 50, topics: [APP_UNINSTALLED]) {
        nodes { uri }
      }
    }`
  );
  if (existing.webhookSubscriptions?.nodes?.some((node) => node.uri === input.callbackUrl)) return false;

  const created = await shopifyGraphql<WebhookMutationData>(
    input.shopDomain,
    input.accessToken,
    `mutation CreateAppUninstalledWebhook($subscription: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: APP_UNINSTALLED, webhookSubscription: $subscription) {
        webhookSubscription { id }
        userErrors { message }
      }
    }`,
    { subscription: { callbackUrl: input.callbackUrl, format: 'JSON' } }
  );
  const result = created.webhookSubscriptionCreate;
  if (result?.userErrors?.length) throw new Error(result.userErrors.map((error) => error.message || 'Unknown Shopify webhook error').join('; '));
  if (!result?.webhookSubscription?.id) throw new Error('Shopify did not create the uninstall webhook');
  return true;
}
