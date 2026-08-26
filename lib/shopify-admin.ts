/**
 * Shopify Admin API Client
 * Handles order creation, tagging, and idempotency checks
 */

import type { StoreConfig } from './store-configs';
import type { CheckoutLineItem } from './checkout-sessions';
import { acquireCheckoutLock, releaseCheckoutLock } from './checkout-sessions';

const SHOPIFY_ADMIN_API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || '2026-07';

function adminUrl(storeConfig: StoreConfig, resource: string) {
  return `https://${storeConfig.shopDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/${resource}`;
}

async function adminGraphql<T>(
  storeConfig: StoreConfig,
  query: string,
  variables: Record<string, unknown>,
  operation: string
): Promise<T> {
  const response = await fetch(adminUrl(storeConfig, 'graphql.json'), {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': storeConfig.shopifyAdminAccessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`${operation} failed: ${response.status}`);
  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(`${operation} failed: ${payload.errors.map((error: any) => error.message || 'Unknown GraphQL error').join('; ')}`);
  }
  return payload.data as T;
}

function assertNoUserErrors(errors: Array<{ field?: string[]; message?: string }> | undefined, operation: string) {
  if (!errors?.length) return;
  throw new Error(`${operation} failed: ${errors.map((error) => error.message || error.field?.join('.') || 'Unknown user error').join('; ')}`);
}

function resourceGid(resource: 'DraftOrder' | 'Order', id: string) {
  if (id.startsWith(`gid://shopify/${resource}/`)) return id;
  if (/^\d+$/.test(id)) return `gid://shopify/${resource}/${id}`;
  throw new Error(`Invalid Shopify ${resource} id`);
}

function numericOrderNumber(name: unknown) {
  const match = String(name || '').match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function money(amount: number, currencyCode: string) {
  return { amount: Number(amount || 0).toFixed(2), currencyCode };
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

function variantGid(variantId: string) {
  if (variantId.startsWith('gid://shopify/ProductVariant/')) return variantId;
  if (/^\d+$/.test(variantId)) return `gid://shopify/ProductVariant/${variantId}`;
  throw new Error('Invalid Shopify variant id');
}

function hasTag(tags: unknown, expected: string) {
  const values = Array.isArray(tags) ? tags : String(tags || '').split(',');
  return values.map((tag) => String(tag).trim()).includes(expected);
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
              price { amount currencyCode }
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

      // Admin GraphQL exposes MoneyV2 here, unlike the legacy REST response.
      const price = Number(typeof variant.price === 'object' ? variant.price?.amount : variant.price);
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
  return findShopifyOrderByTag(storeConfig, `payment_intent:${paymentIntentId}`);
}

export async function findShopifyOrderByTag(storeConfig: StoreConfig, expectedTag: string) {
  if (!expectedTag || expectedTag.length > 255) throw new Error('Invalid Shopify order tag');
  const data = await adminGraphql<{
    orders?: { nodes?: Array<{ id: string; name?: string; tags?: string[] }> };
  }>(storeConfig, `query OrderByPayment($query: String!) {
    orders(first: 10, query: $query, reverse: true) {
      nodes { id name tags }
    }
  }`, { query: `tag:${JSON.stringify(expectedTag)}` }, 'Shopify order lookup');
  const existing = data.orders?.nodes?.find((order) => hasTag(order.tags, expectedTag));
  return existing ? { ...existing, order_number: numericOrderNumber(existing.name) } : null;
}

async function findDraftOrderByKey(
  storeConfig: StoreConfig,
  draftKey: string
): Promise<{ id: string; invoice_url?: string } | null> {
  const expectedTag = `draft_key:${draftKey}`;
  const data = await adminGraphql<{
    draftOrders?: { nodes?: Array<{ id: string; invoiceUrl?: string; tags?: string[] }> };
  }>(storeConfig, `query DraftOrderByKey($query: String!) {
    draftOrders(first: 10, query: $query, reverse: true) {
      nodes { id invoiceUrl tags }
    }
  }`, { query: `tag:${JSON.stringify(expectedTag)}` }, 'Shopify draft order lookup');
  const existing = data.draftOrders?.nodes?.find((draft) => hasTag(draft.tags, expectedTag));
  return existing ? { id: existing.id, invoice_url: existing.invoiceUrl } : null;
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
    const currency = orderData.storeConfig.currency;
    const lineItemsPayload = orderData.lineItems.map((item) => ({
      variantId: variantGid(item.variantId),
      ...(item.productId ? { productId: item.productId } : {}),
      quantity: item.quantity,
      title: item.title,
      priceSet: { shopMoney: money(Number(item.price || 0), currency) },
      requiresShipping: true,
      taxable: true,
    }));

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
    ].filter(Boolean);

    const noteAttributes = [
      { key: 'payment_intent_id', value: orderData.paymentIntentId },
      { key: 'parent_payment_intent_id', value: orderData.parentPaymentIntentId || '' },
      { key: 'order_type', value: orderData.orderType || 'checkout' },
      { key: 'checkout_session_id', value: orderData.checkoutSessionId || orderData.cartId || '' },
      { key: 'cid', value: orderData.cid || '' },
      { key: 'source_url', value: orderData.sourceUrl || '' },
      { key: 'shipping_method', value: orderData.shippingMethod || '' },
      { key: 'utm_source', value: orderData.utm?.source || '' },
      { key: 'utm_campaign', value: orderData.utm?.campaign || '' },
      { key: 'utm_medium', value: orderData.utm?.medium || '' },
      { key: 'utm_content', value: orderData.utm?.content || '' },
      { key: 'utm_term', value: orderData.utm?.term || '' },
    ].filter((attribute) => attribute.value);
    const itemSubtotal = orderData.lineItems.reduce((sum, item) => sum + Number(item.price || 0) * item.quantity, 0);
    const total = Number((itemSubtotal + Number(orderData.shippingPrice || 0) + Number(orderData.taxPrice || 0)).toFixed(2));
    const orderInput = {
      email: orderData.email,
      financialStatus: 'PAID',
      fulfillmentStatus: 'UNFULFILLED',
      currency,
      presentmentCurrency: currency,
      tags,
      customAttributes: noteAttributes,
      lineItems: lineItemsPayload,
      shippingAddress: {
        firstName,
        lastName,
        address1: orderData.shippingAddress.address1,
        address2: orderData.shippingAddress.address2 || '',
        city: orderData.shippingAddress.city,
        province: orderData.shippingAddress.province || '',
        zip: orderData.shippingAddress.zip,
        country: orderData.shippingAddress.country,
        phone: orderData.shippingAddress.phone || '',
      },
      ...(orderData.shippingPrice && orderData.shippingPrice > 0
        ? { shippingLines: [{
            title: orderData.shippingMethod === 'express' ? 'Express Shipping' : 'Standard Shipping',
            code: orderData.shippingMethod || 'standard',
            source: 'Omni Checkout',
            priceSet: { shopMoney: money(orderData.shippingPrice, currency) },
          }] }
        : {}),
      ...(orderData.taxPrice && orderData.taxPrice > 0
        ? { taxLines: [{
            title: 'Tax',
            rate: Number(orderData.taxRate || 0),
            priceSet: { shopMoney: money(orderData.taxPrice, currency) },
          }] }
        : {}),
      transactions: [{
        kind: 'SALE',
        status: 'SUCCESS',
        gateway: orderData.paymentIntentId.startsWith('paypal:') ? 'PayPal' : 'Stripe',
        authorizationCode: orderData.paymentIntentId,
        amountSet: { shopMoney: money(total, currency) },
      }],
    };
    const data = await adminGraphql<{
      orderCreate?: {
        order?: { id: string; name?: string; tags?: string[] };
        userErrors?: Array<{ field?: string[]; message?: string }>;
      };
    }>(orderData.storeConfig, `mutation CreateOrder($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
      orderCreate(order: $order, options: $options) {
        order { id name tags }
        userErrors { field message }
      }
    }`, {
      order: orderInput,
      options: { inventoryBehaviour: 'DECREMENT_IGNORING_POLICY', sendReceipt: false },
    }, 'Shopify order creation');
    assertNoUserErrors(data.orderCreate?.userErrors, 'Shopify order creation');
    const order = data.orderCreate?.order;
    if (!order?.id) throw new Error('Shopify order creation returned no order');
    return {
      id: order.id,
      order_number: numericOrderNumber(order.name),
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
  orderData: Omit<OrderData, 'paymentIntentId'> & { draftKey: string; shippingPrice?: number; taxPrice?: number }
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
    const lineItemsPayload: Array<Record<string, unknown>> = orderData.lineItems.map((item) => ({
      variantId: variantGid(item.variantId),
      quantity: item.quantity,
      ...(Number.isFinite(item.price)
        ? { priceOverride: money(Number(item.price), orderData.storeConfig.currency) }
        : {}),
    }));
    if (orderData.taxPrice && orderData.taxPrice > 0) {
      lineItemsPayload.push({
        title: 'Tax',
        quantity: 1,
        originalUnitPriceWithCurrency: money(orderData.taxPrice, orderData.storeConfig.currency),
        taxable: false,
        requiresShipping: false,
      });
    }

    const input = {
          email: orderData.email,
          tags: [
            'OPC-Draft',
            `draft_key:${orderData.draftKey}`,
            orderData.cartId ? `checkout_session:${orderData.cartId}` : '',
            orderData.cid ? `cid:${orderData.cid}` : '',
          ].filter(Boolean),
          customAttributes: [
            { key: 'draft_key', value: orderData.draftKey },
            { key: 'checkout_session_id', value: orderData.checkoutSessionId || orderData.cartId || '' },
            { key: 'cid', value: orderData.cid || '' },
            { key: 'source_url', value: orderData.sourceUrl || '' },
          ].filter((attribute) => attribute.value),
          lineItems: lineItemsPayload,
          ...(orderData.shippingPrice && orderData.shippingPrice > 0
            ? {
                shippingLine: {
                  title: orderData.shippingMethod === 'express' ? 'Express Shipping' : 'Standard Shipping',
                  priceWithCurrency: money(orderData.shippingPrice, orderData.storeConfig.currency),
                },
              }
            : {}),
          shippingAddress: {
            firstName,
            lastName,
            address1: orderData.shippingAddress.address1,
            address2: orderData.shippingAddress.address2 || '',
            city: orderData.shippingAddress.city,
            province: orderData.shippingAddress.province || '',
            zip: orderData.shippingAddress.zip,
            country: orderData.shippingAddress.country,
            phone: orderData.shippingAddress.phone || '',
          },
          presentmentCurrencyCode: orderData.storeConfig.currency,
          taxExempt: true,
          useCustomerDefaultAddress: false,
        };
    const data = await adminGraphql<{
      draftOrderCreate?: {
        draftOrder?: { id: string; invoiceUrl?: string };
        userErrors?: Array<{ field?: string[]; message?: string }>;
      };
    }>(orderData.storeConfig, `mutation CreateDraftOrder($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder { id invoiceUrl }
        userErrors { field message }
      }
    }`, { input }, 'Shopify draft order creation');
    assertNoUserErrors(data.draftOrderCreate?.userErrors, 'Shopify draft order creation');
    const draftOrder = data.draftOrderCreate?.draftOrder;
    if (!draftOrder?.id) throw new Error('Shopify draft order creation returned no draft order');
    return {
      id: draftOrder.id,
      invoice_url: draftOrder.invoiceUrl,
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
  taxPrice?: number;
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
    const lineItems: Array<Record<string, unknown>> = input.lineItems.map((item) => ({
      variantId: variantGid(item.variantId),
      quantity: item.quantity,
      ...(Number.isFinite(item.price)
        ? { priceOverride: money(Number(item.price), input.storeConfig.currency) }
        : {}),
    }));
    if (input.taxPrice && input.taxPrice > 0) {
      lineItems.push({
        title: 'Tax',
        quantity: 1,
        originalUnitPriceWithCurrency: money(input.taxPrice, input.storeConfig.currency),
        taxable: false,
        requiresShipping: false,
      });
    }
    const tags = [
      'OPC-Draft',
      'OPC-Bundled',
      input.checkoutSessionId ? `checkout_session:${input.checkoutSessionId}` : '',
      input.cid ? `cid:${input.cid}` : '',
      ...(input.tags || []),
    ].filter(Boolean);
    const noteAttributes = [
      { key: 'checkout_session_id', value: input.checkoutSessionId || '' },
      { key: 'cid', value: input.cid || '' },
      { key: 'source_url', value: input.sourceUrl || '' },
      ...(input.noteAttributes || []).map((attribute) => ({ key: attribute.name, value: attribute.value })),
    ].filter((attribute) => attribute.value);
    const draftInput = {
            email: input.email,
            tags,
            customAttributes: noteAttributes,
            lineItems,
            ...(input.shippingPrice && input.shippingPrice > 0
              ? {
                  shippingLine: {
                    title: input.shippingMethod === 'express' ? 'Express Shipping' : 'Standard Shipping',
                    priceWithCurrency: money(input.shippingPrice, input.storeConfig.currency),
                  },
                }
              : {}),
            shippingAddress: {
              firstName: input.firstName,
              lastName: input.lastName,
              address1: input.shippingAddress.address1,
              address2: input.shippingAddress.address2 || '',
              city: input.shippingAddress.city,
              province: input.shippingAddress.province || '',
              zip: input.shippingAddress.zip,
              country: input.shippingAddress.country,
              phone: input.shippingAddress.phone || '',
            },
            presentmentCurrencyCode: input.storeConfig.currency,
            taxExempt: true,
            useCustomerDefaultAddress: false,
          };
    const data = await adminGraphql<{
      draftOrderUpdate?: {
        draftOrder?: { id: string; invoiceUrl?: string; status?: string };
        userErrors?: Array<{ field?: string[]; message?: string }>;
      };
    }>(input.storeConfig, `mutation UpdateDraftOrder($id: ID!, $input: DraftOrderInput!) {
      draftOrderUpdate(id: $id, input: $input) {
        draftOrder { id invoiceUrl status }
        userErrors { field message }
      }
    }`, { id: resourceGid('DraftOrder', input.draftOrderId), input: draftInput }, 'Shopify draft order update');
    assertNoUserErrors(data.draftOrderUpdate?.userErrors, 'Shopify draft order update');
    const draftOrder = data.draftOrderUpdate?.draftOrder;
    if (!draftOrder?.id) throw new Error('Shopify draft order update returned no draft order');
    return { id: draftOrder.id, invoice_url: draftOrder.invoiceUrl, status: draftOrder.status };
  } finally {
    await releaseCheckoutLock(lockKey, lockToken);
  }
}

export async function completeShopifyDraftOrder(input: {
  storeConfig: StoreConfig;
  draftOrderId: string;
}): Promise<{ id: string; order_number: number }> {
  const draftId = resourceGid('DraftOrder', input.draftOrderId);
  const readDraft = async () => {
    const data = await adminGraphql<{
      draftOrder?: { id: string; status?: string; order?: { id: string; name?: string } };
    }>(input.storeConfig, `query DraftOrderStatus($id: ID!) {
      draftOrder(id: $id) { id status order { id name } }
    }`, { id: draftId }, 'Shopify draft order lookup');
    return data.draftOrder;
  };

  const completedOrder = (draft: any) => {
    if (draft?.status === 'COMPLETED' && draft.order?.id) {
      return {
        id: draft.order.id,
        order_number: numericOrderNumber(draft.order.name),
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

    const data = await adminGraphql<{
      draftOrderComplete?: {
        draftOrder?: { id: string; status?: string; order?: { id: string; name?: string } };
        userErrors?: Array<{ field?: string[]; message?: string }>;
      };
    }>(input.storeConfig, `mutation CompleteDraftOrder($id: ID!) {
      draftOrderComplete(id: $id, paymentPending: false) {
        draftOrder { id status order { id name } }
        userErrors { field message }
      }
    }`, { id: draftId }, 'Shopify draft order completion');
    assertNoUserErrors(data.draftOrderComplete?.userErrors, 'Shopify draft order completion');
    const order = data.draftOrderComplete?.draftOrder?.order;
    if (!order?.id) throw new Error('Shopify draft order completion returned no order');
    return {
      id: order.id,
      order_number: numericOrderNumber(order.name),
    };
  } finally {
    await releaseCheckoutLock(lockKey, lockToken);
  }
}

/**
 * Get order details from Shopify (for verification)
 */
export async function getShopifyOrder(storeConfig: StoreConfig, orderId: string): Promise<any> {
  const data = await adminGraphql<{
    order?: { id: string; name?: string; tags?: string[]; displayFinancialStatus?: string };
  }>(storeConfig, `query ShopifyOrder($id: ID!) {
    order(id: $id) { id name tags displayFinancialStatus }
  }`, { id: resourceGid('Order', orderId) }, 'Shopify order lookup');
  if (!data.order) throw new Error('Shopify order was not found');
  return { ...data.order, order_number: numericOrderNumber(data.order.name) };
}
