import type { StoreConfig } from './store-configs';

function paypalApiBase(config: StoreConfig) {
  return config.paypalEnv === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

async function getPayPalAccessToken(config: StoreConfig) {
  const clientId = config.paypalClientId;
  const secret = config.paypalClientSecret;

  if (!clientId || !secret) {
    throw new Error('PayPal credentials are not configured');
  }

  const response = await fetch(`${paypalApiBase(config)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    throw new Error(`PayPal auth failed: ${response.status} ${await response.text()}`);
  }

  const json = await response.json();
  return json.access_token as string;
}

export async function createPayPalOrder(input: {
  storeConfig: StoreConfig;
  amount: number;
  currency: string;
  checkoutSessionId: string;
  cid?: string;
  purchaseKind?: 'main' | 'upsell';
  stepId?: string;
}) {
  const accessToken = await getPayPalAccessToken(input.storeConfig);
  const response = await fetch(`${paypalApiBase(input.storeConfig)}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      'PayPal-Request-Id': `${input.checkoutSessionId}:${input.stepId || input.purchaseKind || 'main'}`.slice(0, 108),
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          custom_id: `${input.checkoutSessionId}:${input.stepId || input.purchaseKind || 'main'}`,
          invoice_id: `${input.checkoutSessionId}-${input.stepId || input.purchaseKind || 'main'}`.slice(0, 127),
          amount: {
            currency_code: input.currency.toUpperCase(),
            value: input.amount.toFixed(2),
          },
          description: `Checkout ${input.checkoutSessionId}${input.cid ? ` / ${input.cid}` : ''}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`PayPal order creation failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

export async function getPayPalOrder(storeConfig: StoreConfig, orderId: string) {
  const accessToken = await getPayPalAccessToken(storeConfig);
  const response = await fetch(`${paypalApiBase(storeConfig)}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`PayPal order lookup failed: ${response.status}`);
  return response.json();
}

export async function capturePayPalOrder(storeConfig: StoreConfig, orderId: string) {
  const accessToken = await getPayPalAccessToken(storeConfig);
  const response = await fetch(`${paypalApiBase(storeConfig)}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
  });

  if (!response.ok) {
    throw new Error(`PayPal capture failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}
