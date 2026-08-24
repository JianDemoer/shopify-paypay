import crypto from 'crypto';

interface PurchaseTrackingInput {
  eventId: string;
  orderId: string;
  orderNumber: number;
  amount: number;
  currency: string;
  email?: string;
  phone?: string;
  cid?: string;
  checkoutSessionId?: string;
  sourceUrl?: string;
  utm?: Record<string, string>;
  lineItems?: Array<{
    variantId?: string;
    productId?: string;
    title?: string;
    quantity?: number;
    price?: number;
  }>;
}

function sha256(value?: string) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function compact<T extends Record<string, any>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== '')
  ) as Partial<T>;
}

function itemIds(lineItems: PurchaseTrackingInput['lineItems']) {
  return (lineItems || [])
    .map((item) => item.variantId || item.productId)
    .filter(Boolean);
}

async function sendMetaPurchase(input: PurchaseTrackingInput) {
  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!pixelId || !accessToken) return;

  const payload = {
    data: [
      {
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: input.eventId,
        action_source: 'website',
        event_source_url: input.sourceUrl,
        user_data: compact({
          em: sha256(input.email),
          ph: sha256(input.phone),
          external_id: sha256(input.cid || input.checkoutSessionId),
          fbp: input.cid,
        }),
        custom_data: compact({
          currency: input.currency.toUpperCase(),
          value: input.amount,
          order_id: String(input.orderId),
          content_ids: itemIds(input.lineItems),
          content_type: 'product',
          num_items: input.lineItems?.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
          utm_source: input.utm?.source,
          utm_campaign: input.utm?.campaign,
          utm_medium: input.utm?.medium,
          utm_content: input.utm?.content,
          utm_term: input.utm?.term,
        }),
      },
    ],
  };

  const response = await fetch(
    `https://graph.facebook.com/v20.0/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    throw new Error(`Meta CAPI failed: ${response.status} ${await response.text()}`);
  }
}

async function sendTikTokPurchase(input: PurchaseTrackingInput) {
  const pixelId = process.env.TIKTOK_PIXEL_ID;
  const accessToken = process.env.TIKTOK_ACCESS_TOKEN;
  if (!pixelId || !accessToken) return;

  const payload = {
    pixel_code: pixelId,
    event: 'CompletePayment',
    event_id: input.eventId,
    timestamp: new Date().toISOString(),
    context: {
      page: { url: input.sourceUrl },
      user: compact({
        email: sha256(input.email),
        phone_number: sha256(input.phone),
        external_id: sha256(input.cid || input.checkoutSessionId),
      }),
    },
    properties: compact({
      currency: input.currency.toUpperCase(),
      value: input.amount,
      order_id: String(input.orderId),
      content_ids: itemIds(input.lineItems),
      contents: input.lineItems?.map((item) => ({
        content_id: item.variantId || item.productId,
        content_name: item.title,
        quantity: item.quantity,
        price: item.price,
      })),
    }),
  };

  const response = await fetch('https://business-api.tiktok.com/open_api/v1.3/event/track/', {
    method: 'POST',
    headers: {
      'Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`TikTok Events API failed: ${response.status} ${await response.text()}`);
  }
}

export async function trackPurchase(input: PurchaseTrackingInput) {
  const results = await Promise.allSettled([
    sendMetaPurchase(input),
    sendTikTokPurchase(input),
  ]);

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('Ad purchase tracking failed:', result.reason);
    }
  }
}
