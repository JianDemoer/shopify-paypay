import { ShopifyProduct, ShopifyCart, ShopifyCollection } from '@/types/shopify';
import { getStoreConfig, StoreConfigResolutionError } from './store-configs';
import type { StoreConfig } from './store-configs';

export class ShopifyConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShopifyConfigurationError';
  }
}

type CatalogCredentials =
  | { channel: 'storefront'; domain: string; storefrontAccessToken: string }
  | { channel: 'admin'; store: StoreConfig };

async function catalogCredentials(storeId?: string): Promise<CatalogCredentials> {
  const envDomain = process.env.SHOPIFY_STORE_DOMAIN?.trim();
  const envStorefrontToken = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN?.trim();

  // An explicitly requested store must always resolve from the installed-store
  // registry. This prevents a global preview token from crossing store boundaries.
  try {
    const store = await getStoreConfig(storeId || process.env.CHECKOUT_PUBLIC_STORE_ID || envDomain);
    if (store.storefrontAccessToken) {
      return {
        channel: 'storefront',
        domain: store.shopDomain,
        storefrontAccessToken: store.storefrontAccessToken,
      };
    }
    if (store.shopifyAdminAccessToken) {
      return { channel: 'admin', store };
    }
  } catch (error) {
    if (!(error instanceof StoreConfigResolutionError)) throw error;
    if (!storeId && envDomain && envStorefrontToken) {
      return { channel: 'storefront', domain: envDomain, storefrontAccessToken: envStorefrontToken };
    }
  }

  throw new ShopifyConfigurationError(
    'This store is not connected. Install the Shopify app first; Storefront access is optional.'
  );
}

async function storefrontCredentials(storeId?: string) {
  const credentials = await catalogCredentials(storeId);
  if (credentials.channel !== 'storefront') {
    throw new ShopifyConfigurationError(
      'The Shopify app is installed, but the Storefront API is not enabled. Cart mutations require an optional Storefront token; checkout uses the installed Admin connection.'
    );
  }
  return credentials;
}

async function shopifyFetch<T>({ query, variables }: { query: string; variables?: any }, storeId?: string): Promise<T> {
  const { domain, storefrontAccessToken } = await storefrontCredentials(storeId);

  const endpoint = `https://${domain}/api/${process.env.SHOPIFY_STOREFRONT_API_VERSION || process.env.SHOPIFY_ADMIN_API_VERSION || '2026-07'}/graphql.json`;

  try {
    const result = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': storefrontAccessToken,
      },
      body: JSON.stringify({ query, variables }),
      next: { revalidate: 60 }, // Cache for 60 seconds
    });

    if (!result.ok) {
      throw new Error(`HTTP error! status: ${result.status}`);
    }

    const json = await result.json();

    if (json.errors) {
      throw new Error(json.errors[0].message);
    }

    return json.data;
  } catch (error) {
    console.error('Shopify API Error:', error);
    throw error;
  }
}

const adminProductFields = `
  id
  title
  handle
  description
  descriptionHtml
  vendor
  productType
  featuredImage { url altText }
  variants(first: 100) {
    nodes {
      id
      title
      availableForSale
      price
      compareAtPrice
    }
  }
`;

async function adminShopifyFetch<T>(store: StoreConfig, query: string, variables?: Record<string, unknown>): Promise<T> {
  const endpoint = `https://${store.shopDomain}/admin/api/${process.env.SHOPIFY_ADMIN_API_VERSION || '2026-07'}/graphql.json`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': store.shopifyAdminAccessToken,
    },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  });

  if (!response.ok) throw new Error(`Shopify Admin API HTTP error! status: ${response.status}`);
  const json = await response.json();
  if (json.errors?.length) throw new Error(json.errors[0].message || 'Shopify Admin API error');
  return json.data as T;
}

function stripHtml(value: string | undefined) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function connectionNodes(value: any): any[] {
  if (Array.isArray(value?.nodes)) return value.nodes;
  return Array.isArray(value?.edges) ? value.edges.map((edge: any) => edge.node) : [];
}

function moneyAmount(value: unknown) {
  if (value && typeof value === 'object' && 'amount' in value) return String((value as { amount?: unknown }).amount || '0.00');
  return String(value || '0.00');
}

function collectionProductCount(value: unknown, fallback = 0) {
  if (value && typeof value === 'object' && 'count' in value) {
    const count = Number((value as { count?: unknown }).count);
    return Number.isFinite(count) ? count : fallback;
  }
  const count = Number(value);
  return Number.isFinite(count) ? count : fallback;
}

function adminProduct(node: any, currencyCode: string): ShopifyProduct {
  const variants = connectionNodes(node.variants).map((variant: any) => ({
    id: variant.id,
    title: variant.title,
    availableForSale: variant.availableForSale !== false,
    price: { amount: moneyAmount(variant.price), currencyCode: variant.price?.currencyCode || currencyCode },
    ...(variant.compareAtPrice != null
      ? { compareAtPrice: { amount: moneyAmount(variant.compareAtPrice), currencyCode: variant.compareAtPrice?.currencyCode || currencyCode } }
      : {}),
  }));
  const availableVariants = variants.filter((variant) => variant.availableForSale);
  const minVariant = [...variants].sort((left, right) => Number(left.price.amount) - Number(right.price.amount))[0];
  const descriptionHtml = String(node.descriptionHtml || '');

  return {
    id: node.id,
    title: node.title,
    handle: node.handle,
    description: stripHtml(node.description || descriptionHtml),
    descriptionHtml,
    availableForSale: availableVariants.length > 0,
    vendor: node.vendor || undefined,
    productType: node.productType || undefined,
    featuredImage: node.featuredImage?.url
      ? { url: node.featuredImage.url, altText: node.featuredImage.altText || undefined }
      : undefined,
    variants,
    priceRange: {
      minVariantPrice: {
        amount: minVariant?.price.amount || '0.00',
        currencyCode,
      },
    },
  };
}

async function adminProducts(store: StoreConfig, query?: string) {
  const data = await adminShopifyFetch<{ products: { nodes: any[] } }>(
    store,
    `query AdminProducts($query: String) {
      products(first: 24, query: $query) { nodes { ${adminProductFields} } }
    }`,
    query ? { query } : undefined,
  );
  return data.products.nodes.map((node) => adminProduct(node, store.currency || 'USD'));
}

async function adminProductByHandle(store: StoreConfig, handle: string) {
  const products = await adminProducts(store, `handle:${JSON.stringify(handle)}`);
  return products.find((product) => product.handle === handle) || null;
}

async function adminCollections(store: StoreConfig) {
  const data = await adminShopifyFetch<{ collections: { nodes: any[] } }>(
    store,
    `query AdminCollections {
      collections(first: 24) {
        nodes { id title handle description descriptionHtml image { url altText } productsCount { count } }
      }
    }`,
  );
  return data.collections.nodes.map((node) => ({
    id: node.id,
    title: node.title,
    handle: node.handle,
    description: stripHtml(node.description || node.descriptionHtml),
    descriptionHtml: node.descriptionHtml || '',
    image: node.image?.url ? { url: node.image.url, altText: node.image.altText || undefined } : undefined,
    productsCount: collectionProductCount(node.productsCount),
  }));
}

async function adminCollectionByHandle(store: StoreConfig, handle: string) {
  const data = await adminShopifyFetch<{ collections: { nodes: any[] } }>(
    store,
    `query AdminCollection($query: String!) {
      collections(first: 1, query: $query) {
        nodes {
          id title handle description descriptionHtml image { url altText } productsCount { count }
          products(first: 24) { nodes { ${adminProductFields} } }
        }
      }
    }`,
    { query: `handle:${JSON.stringify(handle)}` },
  );
  const node = data.collections.nodes[0];
  if (!node || node.handle !== handle) return null;
  return {
    id: node.id,
    title: node.title,
    handle: node.handle,
    description: stripHtml(node.description || node.descriptionHtml),
    descriptionHtml: node.descriptionHtml || '',
    image: node.image?.url ? { url: node.image.url, altText: node.image.altText || undefined } : undefined,
    products: connectionNodes(node.products).map((product) => adminProduct(product, store.currency || 'USD')),
    productsCount: collectionProductCount(node.productsCount, connectionNodes(node.products).length),
  };
}

// Get all products. The installed Admin OAuth connection is the default
// catalog source; Storefront API remains an optional faster read channel.
export async function getProducts(storeId?: string): Promise<ShopifyProduct[]> {
  const credentials = await catalogCredentials(storeId);
  if (credentials.channel === 'admin') return adminProducts(credentials.store);

  const query = `
    query GetProducts {
      products(first: 24) {
        edges {
          node {
            id
            title
            handle
            description
            availableForSale
            vendor
            productType
            featuredImage {
              url
              altText
            }
            priceRange {
              minVariantPrice {
                amount
                currencyCode
              }
            }
            variants(first: 1) {
              edges {
                node {
                  id
                  title
                  availableForSale
                  price {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const response = await shopifyFetch<{ products: { edges: { node: any }[] } }>({ query }, storeId);
  
  return response.products.edges.map(({ node }) => ({
    ...node,
    variants: node.variants.edges.map(({ node: variant }: any) => variant),
  }));
}

// Get single product by handle
export async function getProduct(handle: string, storeId?: string): Promise<ShopifyProduct | null> {
  const credentials = await catalogCredentials(storeId);
  if (credentials.channel === 'admin') return adminProductByHandle(credentials.store, handle);

  const query = `
    query GetProduct($handle: String!) {
      product(handle: $handle) {
        id
        title
        handle
        description
        descriptionHtml
        availableForSale
        vendor
        productType
        featuredImage {
          url
          altText
        }
        priceRange {
          minVariantPrice {
            amount
            currencyCode
          }
        }
        variants(first: 10) {
          edges {
            node {
              id
              title
              availableForSale
              price {
                amount
                currencyCode
              }
              compareAtPrice {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
  `;

  const response = await shopifyFetch<{ product: any }>({ 
    query, 
    variables: { handle } 
  }, storeId);

  if (!response.product) {
    return null;
  }

  return {
    ...response.product,
    variants: response.product.variants.edges.map(({ node }: any) => node),
  };
}

// Create cart
export async function createCart(storeId?: string): Promise<ShopifyCart> {
  const query = `
    mutation CreateCart {
      cartCreate {
        cart {
          id
          checkoutUrl
          lines(first: 10) {
            edges {
              node {
                id
                quantity
                merchandise {
                  ... on ProductVariant {
                    id
                    title
                    product {
                      title
                      handle
                      featuredImage {
                        url
                        altText
                      }
                    }
                    price {
                      amount
                      currencyCode
                    }
                  }
                }
              }
            }
          }
          cost {
            totalAmount {
              amount
              currencyCode
            }
            subtotalAmount {
              amount
              currencyCode
            }
          }
        }
      }
    }
  `;

  const response = await shopifyFetch<{ cartCreate: { cart: any } }>({ query }, storeId);
  
  return {
    ...response.cartCreate.cart,
    lines: response.cartCreate.cart.lines.edges.map(({ node }: any) => node),
  };
}

// Add to cart
export async function addToCart(cartId: string, variantId: string, quantity: number = 1, storeId?: string): Promise<ShopifyCart> {
  const query = `
    mutation AddToCart($cartId: ID!, $lines: [CartLineInput!]!) {
      cartLinesAdd(cartId: $cartId, lines: $lines) {
        cart {
          id
          checkoutUrl
          lines(first: 10) {
            edges {
              node {
                id
                quantity
                merchandise {
                  ... on ProductVariant {
                    id
                    title
                    product {
                      title
                      handle
                      featuredImage {
                        url
                        altText
                      }
                    }
                    price {
                      amount
                      currencyCode
                    }
                  }
                }
              }
            }
          }
          cost {
            totalAmount {
              amount
              currencyCode
            }
            subtotalAmount {
              amount
              currencyCode
            }
          }
        }
      }
    }
  `;

  const response = await shopifyFetch<{ cartLinesAdd: { cart: any } }>({
    query,
    variables: {
      cartId,
      lines: [{ merchandiseId: variantId, quantity }],
    },
  }, storeId);

  return {
    ...response.cartLinesAdd.cart,
    lines: response.cartLinesAdd.cart.lines.edges.map(({ node }: any) => node),
  };
}

// Update cart line
export async function updateCartLine(cartId: string, lineId: string, quantity: number, storeId?: string): Promise<ShopifyCart> {
  const query = `
    mutation UpdateCartLine($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
      cartLinesUpdate(cartId: $cartId, lines: $lines) {
        cart {
          id
          checkoutUrl
          lines(first: 10) {
            edges {
              node {
                id
                quantity
                merchandise {
                  ... on ProductVariant {
                    id
                    title
                    product {
                      title
                      handle
                      featuredImage {
                        url
                        altText
                      }
                    }
                    price {
                      amount
                      currencyCode
                    }
                  }
                }
              }
            }
          }
          cost {
            totalAmount {
              amount
              currencyCode
            }
            subtotalAmount {
              amount
              currencyCode
            }
          }
        }
      }
    }
  `;

  const response = await shopifyFetch<{ cartLinesUpdate: { cart: any } }>({
    query,
    variables: {
      cartId,
      lines: [{ id: lineId, quantity }],
    },
  }, storeId);

  return {
    ...response.cartLinesUpdate.cart,
    lines: response.cartLinesUpdate.cart.lines.edges.map(({ node }: any) => node),
  };
}

// Remove from cart
export async function removeFromCart(cartId: string, lineId: string, storeId?: string): Promise<ShopifyCart> {
  const query = `
    mutation RemoveFromCart($cartId: ID!, $lineIds: [ID!]!) {
      cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
        cart {
          id
          checkoutUrl
          lines(first: 10) {
            edges {
              node {
                id
                quantity
                merchandise {
                  ... on ProductVariant {
                    id
                    title
                    product {
                      title
                      handle
                      featuredImage {
                        url
                        altText
                      }
                    }
                    price {
                      amount
                      currencyCode
                    }
                  }
                }
              }
            }
          }
          cost {
            totalAmount {
              amount
              currencyCode
            }
            subtotalAmount {
              amount
              currencyCode
            }
          }
        }
      }
    }
  `;

  const response = await shopifyFetch<{ cartLinesRemove: { cart: any } }>({
    query,
    variables: {
      cartId,
      lineIds: [lineId],
    },
  }, storeId);

  return {
    ...response.cartLinesRemove.cart,
    lines: response.cartLinesRemove.cart.lines.edges.map(({ node }: any) => node),
  };
}

// Get all collections
export async function getCollections(storeId?: string): Promise<ShopifyCollection[]> {
  const credentials = await catalogCredentials(storeId);
  if (credentials.channel === 'admin') return adminCollections(credentials.store);

  const query = `
    query GetCollections {
      collections(first: 24) {
        edges {
          node {
            id
            title
            handle
            description
            image {
              url
              altText
            }
            products(first: 100) {
              edges {
                node {
                  id
                }
              }
            }
          }
        }
      }
    }
  `;

  const response = await shopifyFetch<{ collections: { edges: { node: any }[] } }>({ query }, storeId);

  return response.collections.edges.map(({ node }) => ({
    ...node,
    productsCount: node.products.edges.length,
  }));
}

// Get single collection by handle with products
export async function getCollection(handle: string, storeId?: string): Promise<ShopifyCollection | null> {
  const credentials = await catalogCredentials(storeId);
  if (credentials.channel === 'admin') return adminCollectionByHandle(credentials.store, handle);

  const query = `
    query GetCollection($handle: String!) {
      collection(handle: $handle) {
        id
        title
        handle
        description
        descriptionHtml
        image {
          url
          altText
        }
        products(first: 24) {
          edges {
            node {
              id
              title
              handle
              description
              availableForSale
              vendor
              productType
              featuredImage {
                url
                altText
              }
              priceRange {
                minVariantPrice {
                  amount
                  currencyCode
                }
              }
              variants(first: 1) {
                edges {
                  node {
                    id
                    title
                    availableForSale
                    price {
                      amount
                      currencyCode
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const response = await shopifyFetch<{ collection: any }>({ 
    query, 
    variables: { handle } 
  }, storeId);

  if (!response.collection) {
    return null;
  }

  return {
    ...response.collection,
    products: response.collection.products.edges.map(({ node }: any) => ({
      ...node,
      variants: node.variants.edges.map(({ node: variant }: any) => variant),
    })),
    productsCount: response.collection.products.edges.length,
  };
}

// Search products
export async function searchProducts(searchQuery: string, storeId?: string): Promise<ShopifyProduct[]> {
  const credentials = await catalogCredentials(storeId);
  if (credentials.channel === 'admin') return adminProducts(credentials.store, searchQuery);

  const query = `
    query SearchProducts($query: String!) {
      products(first: 24, query: $query) {
        edges {
          node {
            id
            title
            handle
            description
            availableForSale
            vendor
            productType
            featuredImage {
              url
              altText
            }
            priceRange {
              minVariantPrice {
                amount
                currencyCode
              }
            }
            variants(first: 1) {
              edges {
                node {
                  id
                  title
                  availableForSale
                  price {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const response = await shopifyFetch<{ products: { edges: { node: any }[] } }>({ 
    query,
    variables: { query: searchQuery }
  }, storeId);
  
  return response.products.edges.map(({ node }) => ({
    ...node,
    variants: node.variants.edges.map(({ node: variant }: any) => variant),
  }));
}
