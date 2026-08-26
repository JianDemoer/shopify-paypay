type ShopMetadataResponse = {
  data?: {
    shop?: {
      name?: string;
      currencyCode?: string;
    };
  };
  errors?: Array<{ message?: string }>;
};

export interface ShopifyShopMetadata {
  name: string;
  currency: string;
}

export async function getShopifyShopMetadata(input: {
  shopDomain: string;
  accessToken: string;
}): Promise<ShopifyShopMetadata> {
  const version = process.env.SHOPIFY_ADMIN_API_VERSION || '2026-07';
  const response = await fetch(`https://${input.shopDomain}/admin/api/${version}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': input.accessToken,
    },
    body: JSON.stringify({ query: 'query InstalledShop { shop { name currencyCode } }' }),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Shopify shop metadata request failed: ${response.status}`);

  const payload = await response.json() as ShopMetadataResponse;
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message || 'Unknown Shopify GraphQL error').join('; '));
  }
  const name = payload.data?.shop?.name?.trim() || '';
  const currency = payload.data?.shop?.currencyCode?.trim().toUpperCase() || '';
  if (!name || !/^[A-Z]{3}$/.test(currency)) throw new Error('Shopify returned incomplete shop metadata');
  return { name, currency };
}
