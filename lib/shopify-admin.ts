/**
 * Shopify Admin API Client
 * Handles order creation, tagging, and idempotency checks
 */

import type { StoreConfig } from './store-configs';
import type { CheckoutLineItem } from './checkout-sessions';
import { acquireCheckoutLock, releaseCheckoutLock } from './checkout-sessions';

const SHOPIFY_ADMIN_API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || '2025-10';

function adminUrl(storeConfig: StoreConfig, resource: string) {
  return `https://${storeConfig.shopDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/${resource}`;
}

export interface LineItem {
  variantId: string;
  productId?: string;
  quantity: number;
  title?: string;
  price?: number;
}

export interface ShippingAddress {
  firstName: string;
  lastName: string;
  address1: string;
  address2?: string;
  city: string;
  province?: string;
  zip: string;
  country: string;
  email?: string;
  phone?: string;
}

export interface OrderData {
  storeConfig: StoreConfig;
  email: string;
  firstName: string;
  lastName: string;
  lineItems: LineItem[];
  shippingAddress: ShippingAddress;
  paymentIntentId: string;
  cartId?: string;
  checkoutSessionId?: string;
  cid?: string;
  sourceUrl?: string;
  shippingMethod?: string;
  shippingPrice?: number;
  taxPrice?: number;
  taxRate?: number;
  parentPaymentIntentId?: string;
  orderType?: string;
  utm?: Record<string, string>;
}

function restVariantId(variantId: string) {
  return variantId.includes('gid://') ? variantId.split('/').pop() || variantId : variantId;
}

function variantGid(variantId: string) {
  if (variantId.startsWith('gid://shopify/ProductVariant/')) return variantId;
  if (/^\d+$/.test(variantId)) return `gid://shopify/ProductVariant/${variantId}`;
  throw new Error('Invalid Shopify variant id');
}

function hasTag(tags: unknown, expected: string) {
  return String(tags || '').split(',').map((tag) => tag.trim()).includes(expected);
}

function nextPageUrl(linkHeader: string | null) {
  const nextLink = linkHeader?.split(',').find((part) => part.includes('rel="next"'));
  return nextLink?.match(/<([^>]+)>/)?.[1] || null;
}

export async function resolveCheckoutLineItems(
  storeConfig: StoreConfig,
  input: any
): Promise<CheckoutLineItem[]> {
  const rawItems = Array.isArray(input?.items) && input.items.length > 0
    ? input.items
    : [input];

  if (rawItems.length === 0 || rawItems.length > 50) {
    throw new Error('Checkout must contain between 1 and 50 items');
  }

  const cache = new Map<string, CheckoutLineItem>();
  const items: CheckoutLineItem[] = [];
  for (const rawItem of rawItems) {
    const quantity = Number(rawItem?.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new Error('Invalid checkout quantity');
    }

    const gid = variantGid(String(rawItem?.variantId || ''));
    let item = cache.get(gid);
    if (!item) {
      const response = await fetch(adminUrl(storeConfig, 'graphql.json'), {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': storeConfig.shopifyAdminAccessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: `query CheckoutVariant($id: ID!) {
            productVariant(id: $id) {
              id
              title
              price
              product { id title }
              image { url }
            }
          }`,
          variables: { id: gid },
        }),
      });

      if (!response.ok) throw new Error(`Shopify variant lookup failed: ${response.status}`);
      const json = await response.json();
      const variant = json.data?.productVariant;
      if (json.errors?.length || !variant) {
        throw new Error('Shopify product variant is unavailable');
      }

      const price = Number(variant.price);
      if (!Number.isFinite(price) || price < 0) throw new Error('Shopify returned an invalid variant price');
      item = {
        id: gid,
        variantId: gid,
        productId: variant.product?.id,
        title: variant.product?.title
          ? `${variant.product.title}${variant.title && variant.title !== 'Default Title' ? ` - ${variant.title}` : ''}`
          : variant.title,
        quantity: 1,
        price: Number(price.toFixed(2)),
        image: variant.image?.url,
      };
      cache.set(gid, item);
    }

    items.push({ ...item, quantity });
  }
  return items;
}

/**
 * Check if an order already exists for this payment intent (idempotency)
 */
async function checkOrderByPaymentIntentId(
  storeConfig: StoreConfig,
  paymentIntentId: string
): Promise<any | null> {
  try {
    let url: string | null = adminUrl(storeConfig, 'orders.json') + '?status=any&limit=250&fields=id,order_number,tags,financial_status';
    while (url) {
      const response = await fetch(url, {
        headers: {
          'X-Shopify-Access-Token': storeConfig.shopifyAdminAccessToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) throw new Error(`Shopify API error: ${response.status}`);

      const { orders } = await response.json();
      const existingOrder = orders?.find((order: any) => hasTag(order.tags, `payment_intent:${paymentIntentId}`));
      if (existingOrder) return existingOrder;
      url = nextPageUrl(response.headers.get('link'));
    }
    return null;
  } catch (error) {
    console.error('Error checking order by payment intent:', error);
    throw error;
  }
}

async function findDraftOrderByKey(
  storeConfig: StoreConfig,
  draftKey: string
): Promise<{ id: string; invoice_url?: string } | null> {
  let url: string | null = adminUrl(storeConfig, 'draft_orders.json') + '?status=any&limit=250&fields=id,invoice_url,tags,status';
  while (url) {
    const response = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': storeConfig.shopifyAdminAccessToken,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) throw new Error(`Shopify draft order lookup failed: ${response.status}`);

    const { draft_orders: existingDrafts } = await response.json();
    const existing = existingDrafts?.find((draft: any) => hasTag(draft.tags, `draft_key:${draftKey}`));
    if (existing) return { id: String(existing.id), invoice_url: existing.invoice_url };
    url = nextPageUrl(response.headers.get('link'));
  }
  return null;
}

/**
 * Create order in Shopify Admin
 * - Idempotency check: Prevents duplicate orders from webhook retries
 * - Inventory: Uses 'decrement_ignoring_policy' to track stock in real-time
 */
export async function createShopifyOrder(
  orderData: OrderData
): Promise<{ id: string; order_number: number }> {
  try {
    console.log('Creating Shopify order for payment intent:', orderData.paymentIntentId);

    // STEP 1: Check if order already exists (idempotency guard)
    const existingOrder = await checkOrderByPaymentIntentId(
      orderData.storeConfig,
      orderData.paymentIntentId
    );

    if (existingOrder) {
      console.log(
        `✅ Order already exists (idempotency): #${existingOrder.order_number}`
      );
      return {
        id: existingOrder.id,
        order_number: existingOrder.order_number || 0,
      };
    }

    const lockKey = `${orderData.storeConfig.id}:${orderData.paymentIntentId}`;
    const lockToken = await acquireCheckoutLock(lockKey);
    if (!lockToken) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const retryOrder = await checkOrderByPaymentIntentId(orderData.storeConfig, orderData.paymentIntentId);
      if (retryOrder) {
        return { id: retryOrder.id, order_number: retryOrder.order_number || 0 };
      }
      throw new Error('Order creation is already in progress');
    }

    try {
    // STEP 2: Create new order with inventory tracking
    const lineItemsPayload = orderData.lineItems.map((item) => {
      return {
        variant_id: restVariantId(item.variantId),
        quantity: item.quantity,
        title: item.title,
        price: item.price,
      };
    });

    // Use provided names or fallback to defaults
    const firstName = orderData.firstName || 'Guest';
    const lastName = orderData.lastName || 'Customer';
    const tags = [
      'Stripe-Payment',
      orderData.orderType === 'post_purchase_upsell' ? 'Post-Purchase-Upsell' : '',
      orderData.orderType === 'paypal_checkout' ? 'PayPal-Payment' : '',
      `payment_intent:${orderData.paymentIntentId}`,
      orderData.parentPaymentIntentId ? `parent_payment:${orderData.parentPaymentIntentId}` : '',
      orderData.cartId ? `checkout_session:${orderData.cartId}` : '',
      orderData.cid ? `cid:${orderData.cid}` : '',
    ].filter(Boolean).join(', ');

    const noteAttributes = [
      { name: 'payment_intent_id', value: orderData.paymentIntentId },
      { name: 'parent_payment_intent_id', value: orderData.parentPaymentIntentId || '' },
      { name: 'order_type', value: orderData.orderType || 'checkout' },
      { name: 'checkout_session_id', value: orderData.checkoutSessionId || orderData.cartId || '' },
      { name: 'cid', value: orderData.cid || '' },
      { name: 'source_url', value: orderData.sourceUrl || '' },
      { name: 'shipping_method', value: orderData.shippingMethod || '' },
      { name: 'utm_source', value: orderData.utm?.source || '' },
      { name: 'utm_campaign', value: orderData.utm?.campaign || '' },
      { name: 'utm_medium', value: orderData.utm?.medium || '' },
      { name: 'utm_content', value: orderData.utm?.content || '' },
      { name: 'utm_term', value: orderData.utm?.term || '' },
    ].filter((attribute) => attribute.value);

    const response = await fetch(
      adminUrl(orderData.storeConfig, 'orders.json'),
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': orderData.storeConfig.shopifyAdminAccessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          order: {
            email: orderData.email,
            financial_status: 'paid',
            fulfillment_status: 'unfulfilled',
            
            // Tag with payment intent ID during creation (single API call)
            tags,
            note_attributes: noteAttributes,

            // Customer data with name and address
            customer: {
              first_name: firstName,
              last_name: lastName,
              email: orderData.email,
            },

            // Line items
            line_items: lineItemsPayload,

            // Shipping address
            shipping_address: {
              first_name: firstName,
              last_name: lastName,
              address1: orderData.shippingAddress.address1,
              address2: orderData.shippingAddress.address2 || '',
              city: orderData.shippingAddress.city,
              province: orderData.shippingAddress.province || '',
              zip: orderData.shippingAddress.zip,
              country: orderData.shippingAddress.country,
              phone: orderData.shippingAddress.phone || '',
            },

            ...(orderData.shippingPrice && orderData.shippingPrice > 0
              ? {
                  shipping_lines: [{
                    title: orderData.shippingMethod === 'express' ? 'Express Shipping' : 'Standard Shipping',
                    price: orderData.shippingPrice.toFixed(2),
                    code: orderData.shippingMethod || 'standard',
                  }],
                }
              : {}),
            ...(orderData.taxPrice && orderData.taxPrice > 0
              ? {
                  tax_lines: [{
                    title: 'Tax',
                    price: orderData.taxPrice.toFixed(2),
                    rate: orderData.taxRate || 0,
                  }],
                }
              : {}),

            // Decrement inventory in real-time for demo visibility
            inventory_behavior: 'decrement_ignoring_policy',
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error('Shopify order creation error:', error);
      throw new Error(`Shopify API error: ${response.status}`);
    }

    const { order } = await response.json();

    console.log(`✅ Order created: #${order.order_number} (ID: ${order.id}) with tags: ${order.tags}`);

    return {
      id: order.id,
      order_number: order.order_number,
    };
    } finally {
      await releaseCheckoutLock(lockKey, lockToken);
    }
  } catch (error) {
    console.error('Error creating Shopify order:', error);
    throw error;
  }
}

export async function createShopifyDraftOrder(
  orderData: Omit<OrderData, 'paymentIntentId'> & { draftKey: string; shippingPrice?: number }
): Promise<{ id: string; invoice_url?: string }> {
  const existing = await findDraftOrderByKey(orderData.storeConfig, orderData.draftKey);
  if (existing) return existing;

  const lockKey = `${orderData.storeConfig.id}:draft:${orderData.draftKey}`;
  const lockToken = await acquireCheckoutLock(lockKey, 120);
  if (!lockToken) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const retry = await findDraftOrderByKey(orderData.storeConfig, orderData.draftKey);
    if (retry) return retry;
    throw new Error('Draft order creation is already in progress');
  }

  try {
    const firstName = orderData.firstName || 'Guest';
    const lastName = orderData.lastName || 'Customer';
    const lineItemsPayload = orderData.lineItems.map((item) => ({
      variant_id: restVariantId(item.variantId),
      quantity: item.quantity,
      title: item.title,
      price: item.price,
    }));

    const response = await fetch(
      adminUrl(orderData.storeConfig, 'draft_orders.json'),
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': orderData.storeConfig.shopifyAdminAccessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          draft_order: {
          email: orderData.email,
          tags: [
            'OPC-Draft',
            `draft_key:${orderData.draftKey}`,
            orderData.cartId ? `checkout_session:${orderData.cartId}` : '',
            orderData.cid ? `cid:${orderData.cid}` : '',
          ].filter(Boolean).join(', '),
          note_attributes: [
            { name: 'draft_key', value: orderData.draftKey },
            { name: 'checkout_session_id', value: orderData.checkoutSessionId || orderData.cartId || '' },
            { name: 'cid', value: orderData.cid || '' },
            { name: 'source_url', value: orderData.sourceUrl || '' },
          ].filter((attribute) => attribute.value),
          line_items: lineItemsPayload,
          ...(orderData.shippingPrice && orderData.shippingPrice > 0
            ? {
                shipping_line: {
                  title: orderData.shippingMethod === 'express' ? 'Express Shipping' : 'Standard Shipping',
                  price: orderData.shippingPrice.toFixed(2),
                },
              }
            : {}),
          shipping_address: {
            first_name: firstName,
            last_name: lastName,
            address1: orderData.shippingAddress.address1,
            address2: orderData.shippingAddress.address2 || '',
            city: orderData.shippingAddress.city,
            province: orderData.shippingAddress.province || '',
            zip: orderData.shippingAddress.zip,
            country: orderData.shippingAddress.country,
            phone: orderData.shippingAddress.phone || '',
          },
          customer: {
            first_name: firstName,
            last_name: lastName,
            email: orderData.email,
          },
          use_customer_default_address: false,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error('Shopify draft order creation error:', error);
      throw new Error(`Shopify Draft Order API error: ${response.status}`);
    }

    const { draft_order } = await response.json();
    return {
      id: String(draft_order.id),
      invoice_url: draft_order.invoice_url,
    };
  } finally {
    await releaseCheckoutLock(lockKey, lockToken);
  }
}

export async function updateShopifyDraftOrder(input: {
  storeConfig: StoreConfig;
  draftOrderId: string;
  email: string;
  firstName: string;
  lastName: string;
  lineItems: LineItem[];
  shippingAddress: ShippingAddress;
  shippingMethod?: string;
  shippingPrice?: number;
  checkoutSessionId?: string;
  cid?: string;
  sourceUrl?: string;
  tags?: string[];
  noteAttributes?: Array<{ name: string; value: string }>;
}) {
  const lockKey = `${input.storeConfig.id}:draft-update:${input.draftOrderId}`;
  const lockToken = await acquireCheckoutLock(lockKey, 120);
  if (!lockToken) throw new Error('Draft order update is already in progress');

  try {
    const lineItems = input.lineItems.map((item) => ({
      variant_id: restVariantId(item.variantId),
      quantity: item.quantity,
      title: item.title,
      price: Number(item.price || 0).toFixed(2),
    }));
    const tags = [
      'OPC-Draft',
      'OPC-Bundled',
      input.checkoutSessionId ? `checkout_session:${input.checkoutSessionId}` : '',
      input.cid ? `cid:${input.cid}` : '',
      ...(input.tags || []),
    ].filter(Boolean).join(', ');
    const noteAttributes = [
      { name: 'checkout_session_id', value: input.checkoutSessionId || '' },
      { name: 'cid', value: input.cid || '' },
      { name: 'source_url', value: input.sourceUrl || '' },
      ...(input.noteAttributes || []),
    ].filter((attribute) => attribute.value);
    const response = await fetch(
      adminUrl(input.storeConfig, `draft_orders/${encodeURIComponent(input.draftOrderId)}.json`),
      {
        method: 'PUT',
        headers: {
          'X-Shopify-Access-Token': input.storeConfig.shopifyAdminAccessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          draft_order: {
            email: input.email,
            tags,
            note_attributes: noteAttributes,
            line_items: lineItems,
            ...(input.shippingPrice && input.shippingPrice > 0
              ? {
                  shipping_line: {
                    title: input.shippingMethod === 'express' ? 'Express Shipping' : 'Standard Shipping',
                    price: input.shippingPrice.toFixed(2),
                  },
                }
              : { shipping_line: null }),
            shipping_address: {
              first_name: input.firstName,
              last_name: input.lastName,
              address1: input.shippingAddress.address1,
              address2: input.shippingAddress.address2 || '',
              city: input.shippingAddress.city,
              province: input.shippingAddress.province || '',
              zip: input.shippingAddress.zip,
              country: input.shippingAddress.country,
              phone: input.shippingAddress.phone || '',
            },
            customer: {
              first_name: input.firstName,
              last_name: input.lastName,
              email: input.email,
            },
            use_customer_default_address: false,
          },
        }),
      }
    );
    if (!response.ok) {
      const error = await response.text();
      console.error('Shopify draft order update error:', error);
      throw new Error(`Shopify Draft Order update error: ${response.status}`);
    }
    const { draft_order: draftOrder } = await response.json();
    return { id: String(draftOrder.id || input.draftOrderId), invoice_url: draftOrder.invoice_url, status: draftOrder.status };
  } finally {
    await releaseCheckoutLock(lockKey, lockToken);
  }
}

export async function completeShopifyDraftOrder(input: {
  storeConfig: StoreConfig;
  draftOrderId: string;
}): Promise<{ id: string; order_number: number }> {
  const draftUrl = adminUrl(input.storeConfig, `draft_orders/${encodeURIComponent(input.draftOrderId)}.json`);
  const readDraft = async () => {
    const response = await fetch(draftUrl, {
      headers: {
        'X-Shopify-Access-Token': input.storeConfig.shopifyAdminAccessToken,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) throw new Error(`Shopify draft order lookup failed: ${response.status}`);
    return (await response.json()).draft_order;
  };

  const completedOrder = (draft: any) => {
    if (draft?.status === 'completed' && draft.order_id) {
      return {
        id: String(draft.order_id),
        order_number: draft.order_number || 0,
      };
    }
    return null;
  };

  const existingDraft = await readDraft();
  const existingOrder = completedOrder(existingDraft);
  if (existingOrder) return existingOrder;

  const lockKey = `${input.storeConfig.id}:draft-complete:${input.draftOrderId}`;
  const lockToken = await acquireCheckoutLock(lockKey, 120);
  if (!lockToken) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    const retryOrder = completedOrder(await readDraft());
    if (retryOrder) return retryOrder;
    throw new Error('Draft order completion is already in progress');
  }

  try {
    const latestDraft = await readDraft();
    const latestOrder = completedOrder(latestDraft);
    if (latestOrder) return latestOrder;

    const response = await fetch(
      adminUrl(input.storeConfig, `draft_orders/${encodeURIComponent(input.draftOrderId)}/complete.json`),
      {
        method: 'PUT',
        headers: {
          'X-Shopify-Access-Token': input.storeConfig.shopifyAdminAccessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ payment_pending: false }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error('Shopify draft order completion error:', error);
      throw new Error(`Shopify Draft Order complete error: ${response.status}`);
    }

    const { draft_order } = await response.json();
    return {
      id: String(draft_order.order_id || draft_order.id),
      order_number: draft_order.order_number || 0,
    };
  } finally {
    await releaseCheckoutLock(lockKey, lockToken);
  }
}

/**
 * Get order details from Shopify (for verification)
 */
export async function getShopifyOrder(storeConfig: StoreConfig, orderId: string): Promise<any> {
  try {
    const response = await fetch(
      adminUrl(storeConfig, `orders/${encodeURIComponent(orderId)}.json`),
      {
        headers: {
          'X-Shopify-Access-Token': storeConfig.shopifyAdminAccessToken,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Shopify API error: ${response.status}`);
    }

    const { order } = await response.json();
    return order;
  } catch (error) {
    console.error('Error fetching Shopify order:', error);
    throw error;
  }
}
