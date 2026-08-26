import {
  getProducts,
  getProduct,
  searchProducts,
  getCollections,
  getCollection,
  createCart,
  addToCart,
} from '../shopify';
import { getStoreConfig, StoreConfigResolutionError } from '../store-configs';

jest.mock('../store-configs', () => ({
  getStoreConfig: jest.fn(),
  StoreConfigResolutionError: class StoreConfigResolutionError extends Error {},
}));

// Mock the global fetch function
global.fetch = jest.fn();

describe('Shopify API Functions', () => {
  const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
  const mockGetStoreConfig = getStoreConfig as jest.MockedFunction<typeof getStoreConfig>;

  beforeEach(() => {
    mockFetch.mockClear();
    mockGetStoreConfig.mockReset();
    mockGetStoreConfig.mockRejectedValue(new StoreConfigResolutionError('No default store'));
    // Set environment variables
    process.env.SHOPIFY_STORE_DOMAIN = 'test-store.myshopify.com';
    process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN = 'test-token';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getProducts', () => {
    it('fetches and returns products successfully', async () => {
      const mockProducts = {
        products: {
          edges: [
            {
              node: {
                id: 'product-1',
                title: 'Test Product',
                handle: 'test-product',
                description: 'A test product',
                availableForSale: true,
                vendor: 'Test Vendor',
                productType: 'T-Shirt',
                featuredImage: {
                  url: 'https://example.com/image.jpg',
                  altText: 'Test image',
                },
                priceRange: {
                  minVariantPrice: {
                    amount: '29.99',
                    currencyCode: 'USD',
                  },
                },
                variants: {
                  edges: [
                    {
                      node: {
                        id: 'variant-1',
                        title: 'Default',
                        availableForSale: true,
                        price: {
                          amount: '29.99',
                          currencyCode: 'USD',
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: mockProducts }),
      } as Response);

      const result = await getProducts();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Test Product');
      expect(result[0].variants).toHaveLength(1);
    });

    it('throws error when environment variables are missing', async () => {
      delete process.env.SHOPIFY_STORE_DOMAIN;

      await expect(getProducts()).rejects.toThrow(
        'Install the Shopify app first'
      );
    });

    it('uses the installed Shopify Admin OAuth connection when Storefront token is absent', async () => {
      delete process.env.SHOPIFY_STORE_DOMAIN;
      delete process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
      mockGetStoreConfig.mockResolvedValue({
        id: 'installed-store.myshopify.com',
        name: 'Installed Store',
        shopDomain: 'installed-store.myshopify.com',
        currency: 'USD',
        shopifyAdminAccessToken: 'shpat_installed',
      } as Awaited<ReturnType<typeof getStoreConfig>>);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            products: {
              nodes: [{
                id: 'gid://shopify/Product/1',
                title: 'Installed Product',
                handle: 'installed-product',
                description: '<p>Product</p>',
                descriptionHtml: '<p>Product</p>',
                vendor: 'Shop',
                productType: 'Demo',
                featuredImage: { url: 'https://example.com/product.jpg', altText: 'Product' },
                variants: {
                  nodes: [{
                    id: 'gid://shopify/ProductVariant/2',
                    title: 'Default Title',
                    availableForSale: true,
                    price: '19.99',
                    compareAtPrice: '24.99',
                  }],
                },
              }],
            },
          },
        }),
      } as Response);

      const result = await getProducts();

      expect(result[0]).toMatchObject({
        id: 'gid://shopify/Product/1',
        title: 'Installed Product',
        description: 'Product',
        availableForSale: true,
      });
      expect(result[0].variants[0].price).toEqual({ amount: '19.99', currencyCode: 'USD' });
      expect(result[0].variants[0].compareAtPrice).toEqual({ amount: '24.99', currencyCode: 'USD' });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://installed-store.myshopify.com/admin/api/2026-07/graphql.json',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Shopify-Access-Token': 'shpat_installed',
          }),
        })
      );
      const request = mockFetch.mock.calls[0][1] as RequestInit;
      expect(String(request.body)).toMatch(/\bprice\b/);
      expect(String(request.body)).not.toContain('price {');
    });

    it('uses the configured default store when environment variables are missing', async () => {
      delete process.env.SHOPIFY_STORE_DOMAIN;
      delete process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
      mockGetStoreConfig.mockResolvedValue({
        shopDomain: 'configured-store.myshopify.com',
        storefrontAccessToken: 'configured-token',
      } as Awaited<ReturnType<typeof getStoreConfig>>);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { products: { edges: [] } } }),
      } as Response);

      await expect(getProducts()).resolves.toEqual([]);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://configured-store.myshopify.com/api/2026-07/graphql.json',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Shopify-Storefront-Access-Token': 'configured-token',
          }),
        })
      );
    });

    it('does not hide store configuration storage failures', async () => {
      delete process.env.SHOPIFY_STORE_DOMAIN;
      delete process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
      mockGetStoreConfig.mockRejectedValue(new Error('Redis unavailable'));

      await expect(getProducts()).rejects.toThrow('Redis unavailable');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('handles API errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          errors: [{ message: 'GraphQL Error' }],
        }),
      } as Response);

      await expect(getProducts()).rejects.toThrow('GraphQL Error');
    });

    it('handles HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      await expect(getProducts()).rejects.toThrow('HTTP error! status: 500');
    });
  });

  describe('getProduct', () => {
    it('fetches and returns single product by handle', async () => {
      const mockProduct = {
        product: {
          id: 'product-1',
          title: 'Test Product',
          handle: 'test-product',
          description: 'A test product',
          availableForSale: true,
          vendor: 'Test Vendor',
          productType: 'T-Shirt',
          featuredImage: {
            url: 'https://example.com/image.jpg',
            altText: 'Test image',
          },
          priceRange: {
            minVariantPrice: {
              amount: '29.99',
              currencyCode: 'USD',
            },
          },
          variants: {
            edges: [
              {
                node: {
                  id: 'variant-1',
                  title: 'Default',
                  availableForSale: true,
                  price: {
                    amount: '29.99',
                    currencyCode: 'USD',
                  },
                },
              },
            ],
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: mockProduct }),
      } as Response);

      const result = await getProduct('test-product');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result).not.toBeNull();
      expect(result?.title).toBe('Test Product');
      expect(result?.handle).toBe('test-product');
    });

    it('returns null when product not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { product: null } }),
      } as Response);

      const result = await getProduct('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('searchProducts', () => {
    it('searches and returns matching products', async () => {
      const mockSearchResults = {
        products: {
          edges: [
            {
              node: {
                id: 'product-1',
                title: 'Blue Shirt',
                handle: 'blue-shirt',
                description: 'A blue shirt',
                availableForSale: true,
                vendor: 'Test Vendor',
                productType: 'T-Shirt',
                featuredImage: {
                  url: 'https://example.com/image.jpg',
                  altText: 'Blue shirt',
                },
                priceRange: {
                  minVariantPrice: {
                    amount: '25.99',
                    currencyCode: 'USD',
                  },
                },
                variants: {
                  edges: [
                    {
                      node: {
                        id: 'variant-1',
                        title: 'Medium',
                        availableForSale: true,
                        price: {
                          amount: '25.99',
                          currencyCode: 'USD',
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: mockSearchResults }),
      } as Response);

      const result = await searchProducts('blue');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Blue Shirt');
    });

    it('returns empty array when no results found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { products: { edges: [] } } }),
      } as Response);

      const result = await searchProducts('xyz123');

      expect(result).toEqual([]);
    });
  });

  describe('getCollections', () => {
    it('fetches and returns collections successfully', async () => {
      const mockCollections = {
        collections: {
          edges: [
            {
              node: {
                id: 'collection-1',
                title: 'Summer Collection',
                handle: 'summer',
                description: 'Summer styles',
                image: {
                  url: 'https://example.com/collection.jpg',
                  altText: 'Summer',
                },
                products: {
                  edges: [],
                },
              },
            },
          ],
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: mockCollections }),
      } as Response);

      const result = await getCollections();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Summer Collection');
    });

    it('uses the Admin GraphQL Count scalar structure for an installed store', async () => {
      delete process.env.SHOPIFY_STORE_DOMAIN;
      delete process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
      mockGetStoreConfig.mockResolvedValue({
        id: 'installed-store.myshopify.com',
        name: 'Installed Store',
        shopDomain: 'installed-store.myshopify.com',
        currency: 'USD',
        shopifyAdminAccessToken: 'shpat_installed',
      } as Awaited<ReturnType<typeof getStoreConfig>>);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            collections: {
              nodes: [{
                id: 'gid://shopify/Collection/1',
                title: 'Installed Collection',
                handle: 'installed',
                description: '',
                descriptionHtml: '',
                productsCount: { count: 7 },
              }],
            },
          },
        }),
      } as Response);

      const result = await getCollections();

      expect(result[0].productsCount).toBe(7);
      const request = mockFetch.mock.calls[0][1] as RequestInit;
      expect(String(request.body)).toContain('productsCount { count }');
    });
  });

  describe('getCollection', () => {
    it('fetches and returns single collection by handle', async () => {
      const mockCollection = {
        collection: {
          id: 'collection-1',
          title: 'Summer Collection',
          handle: 'summer',
          description: 'Summer styles',
          image: {
            url: 'https://example.com/collection.jpg',
            altText: 'Summer',
          },
          products: {
            edges: [
              {
                node: {
                  id: 'product-1',
                  title: 'Summer Shirt',
                  handle: 'summer-shirt',
                  description: 'A summer shirt',
                  availableForSale: true,
                  vendor: 'Test Vendor',
                  productType: 'T-Shirt',
                  featuredImage: {
                    url: 'https://example.com/image.jpg',
                    altText: 'Summer shirt',
                  },
                  priceRange: {
                    minVariantPrice: {
                      amount: '29.99',
                      currencyCode: 'USD',
                    },
                  },
                  variants: {
                    edges: [
                      {
                        node: {
                          id: 'variant-1',
                          title: 'Medium',
                          availableForSale: true,
                          price: {
                            amount: '29.99',
                            currencyCode: 'USD',
                          },
                        },
                      },
                    ],
                  },
                },
              },
            ],
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: mockCollection }),
      } as Response);

      const result = await getCollection('summer');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result).not.toBeNull();
      expect(result?.title).toBe('Summer Collection');
      expect(result?.products).toHaveLength(1);
    });

    it('returns null when collection not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { collection: null } }),
      } as Response);

      const result = await getCollection('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('handles network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(getProducts()).rejects.toThrow('Network error');
    });

    it('logs errors to console', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      
      mockFetch.mockRejectedValueOnce(new Error('Test error'));

      await expect(getProducts()).rejects.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalledWith('Shopify API Error:', expect.any(Error));

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Cart Functions', () => {
    it('creates a new cart', async () => {
      const mockCart = {
        id: 'gid://shopify/Cart/123',
        checkoutUrl: 'https://example.com/checkout',
        lines: { edges: [] },
        cost: {
          totalAmount: { amount: '0.00', currencyCode: 'USD' },
          subtotalAmount: { amount: '0.00', currencyCode: 'USD' },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { cartCreate: { cart: mockCart } } }),
      } as Response);

      const cart = await createCart();
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(cart).toBeDefined();
    });

    it('adds item to cart', async () => {
      const mockCart = {
        id: 'gid://shopify/Cart/123',
        checkoutUrl: 'https://example.com/checkout',
        lines: {
          edges: [{
            node: {
              id: 'line-1',
              quantity: 1,
              merchandise: {
                id: 'variant-1',
                title: 'Test Variant',
                product: {
                  title: 'Test Product',
                  handle: 'test-product',
                  featuredImage: null,
                },
                price: { amount: '29.99', currencyCode: 'USD' },
              },
            },
          }],
        },
        cost: {
          totalAmount: { amount: '29.99', currencyCode: 'USD' },
          subtotalAmount: { amount: '29.99', currencyCode: 'USD' },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { cartLinesAdd: { cart: mockCart } } }),
      } as Response);

      const cart = await addToCart('cart-id', 'variant-id', 1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(cart).toBeDefined();
    });
  });
});
