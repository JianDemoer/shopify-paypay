const PAYPAL_API_BASE = process.env.PAYPAL_ENV === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

async function getPayPalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !secret) {
    throw new Error('PayPal credentials are not configured');
  }

  const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
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
  amount: number;
  currency: string;
  checkoutSessionId: string;
  cid?: string;
}) {
  const accessToken = await getPayPalAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          custom_id: input.checkoutSessionId,
          invoice_id: `${input.checkoutSessionId}-${Date.now()}`,
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

export async function capturePayPalOrder(orderId: string) {
  const accessToken = await getPayPalAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}/capture`, {
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
