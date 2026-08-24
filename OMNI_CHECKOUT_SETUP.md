# Shopify App Proxy Checkout

This fork adds an OmniSecure-style custom checkout flow on top of the original
Next.js Shopify + Stripe project.

## What Is Included

- Product-page takeover script: `/assets/opc-bootstrap.js`
- Checkout session API: `POST /api/checkout/session`
- Session lookup API: `GET /api/checkout/session/:sessionId`
- App Proxy-style checkout route: `/a/s/checkout/:sessionId/entry?cid=...`
- Three-step checkout UI:
  - Contact
  - Shipping
  - Payment
- Stripe PaymentElement for PCI-safe card collection
- PayPal JS SDK checkout with server-side capture and Shopify order creation
- Existing Stripe webhook to create Shopify Admin orders after payment succeeds
- Shopify order tags/note attributes for `payment_intent`, `checkout_session`,
  `cid`, source URL, shipping method, and UTM attribution
- Optional Meta CAPI and TikTok Events API Purchase tracking after Shopify
  order creation succeeds
- Durable checkout sessions through Upstash Redis REST in production, with
  local file storage fallback for development
- Post-purchase upsell route after the main Stripe payment succeeds

## Local Run

```bash
npm install
npm run dev
```

Create a checkout session:

```bash
curl -X POST http://127.0.0.1:3000/api/checkout/session \
  -H 'Content-Type: application/json' \
  -d '{
    "productId": "gid://shopify/Product/1",
    "variantId": "gid://shopify/ProductVariant/2",
    "title": "Demo Product",
    "quantity": 1,
    "price": 49.97,
    "currency": "USD",
    "utm": { "source": "facebook", "campaign": "test" }
  }'
```

Open the returned `redirectUrl`, for example:

```text
http://127.0.0.1:3000/a/s/checkout/opc_xxx/entry?cid=cid_xxx
```

## Required Environment

```bash
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxx
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

NEXT_PUBLIC_PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_ENV=sandbox

SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_xxx
SHOPIFY_APP_PROXY_SECRET=your_shopify_app_secret
SHOPIFY_ORDER_MODE=draft_order

META_PIXEL_ID=123456789
META_ACCESS_TOKEN=EAAB...
TIKTOK_PIXEL_ID=C...
TIKTOK_ACCESS_TOKEN=act....

NEXT_PUBLIC_META_PIXEL_ID=123456789
NEXT_PUBLIC_TIKTOK_PIXEL_ID=C...

UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...

NEXT_PUBLIC_UPSELL_PRODUCT_ID=gid://shopify/Product/...
NEXT_PUBLIC_UPSELL_VARIANT_ID=gid://shopify/ProductVariant/...
```

## Shopify Theme Injection

Add this script through a Shopify App Embed or theme snippet:

```html
<script src="https://YOUR_APP_DOMAIN/assets/opc-bootstrap.js" defer></script>
```

The script intercepts product-page checkout buttons, creates a checkout session,
and redirects the buyer to:

```text
/a/s/checkout/:sessionId/entry?cid=:clientId
```

## Shopify App Proxy

For production inside a Shopify store domain, configure App Proxy:

```text
Subpath prefix: a
Subpath: s
Proxy URL: https://YOUR_APP_DOMAIN/a/s
```

The public Shopify URL will look like:

```text
https://your-store.com/a/s/checkout/:sessionId/entry?cid=...
```

## Payment Safety

Card data is collected by Stripe PaymentElement. The app receives only Stripe
PaymentIntent identifiers and webhook events. Full card numbers and CVC values
do not pass through this app's API.

PayPal payments use the PayPal JS SDK in the browser and server-side capture
through `/api/payment/paypal/capture-order`. The app receives PayPal order and
capture IDs, not buyer card or funding-source credentials.

The custom checkout passes only order metadata to Stripe:

- `checkoutSessionId`
- `cid`
- `sourceUrl`
- `shippingMethod`
- `utm`
- `lineItems`
- `shippingAddress`

Stripe returns the buyer to:

```text
/a/s/checkout/:sessionId/upsell?cid=:cid
```

If the buyer declines the upsell, they continue to:

```text
/checkout/success?checkout_session_id=:sessionId&cid=:cid&upsell=declined
```

If the buyer accepts the upsell, a second Stripe PaymentIntent is created. It is
tagged in Shopify as `Post-Purchase-Upsell` and linked back to the main payment
through `parent_payment:pi_...`.

## Checkout Session Storage

Development fallback:

```text
.data/checkout-sessions.json
```

Production:

```text
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

## Ad Tracking Flow

After `payment_intent.succeeded`:

1. The webhook verifies the Stripe signature.
2. The webhook creates a paid Shopify Admin order.
3. The order is tagged with `payment_intent:...`, `checkout_session:...`, and
   `cid:...`.
4. The same webhook sends server-side Purchase events to Meta/TikTok when the
   corresponding environment variables are configured.
5. Browser-side `InitiateCheckout` and `AddPaymentInfo` events fire on the
   custom checkout when `NEXT_PUBLIC_META_PIXEL_ID` or
   `NEXT_PUBLIC_TIKTOK_PIXEL_ID` is configured.

## PayPal Flow

1. Buyer clicks the PayPal button on the contact step.
2. Browser calls `/api/payment/paypal/create-order`.
3. Buyer approves inside PayPal.
4. Browser calls `/api/payment/paypal/capture-order`.
5. The capture endpoint creates a paid Shopify order tagged as
   `PayPal-Payment`.
6. Buyer continues to the same post-purchase upsell page.

## Draft Order Mode

Set:

```text
SHOPIFY_ORDER_MODE=draft_order
```

In this mode, the Stripe checkout path creates a Shopify Draft Order before
payment. The Stripe webhook completes that draft after
`payment_intent.succeeded`. If `SHOPIFY_ORDER_MODE` is unset, the webhook
creates a paid Shopify Admin order directly.

## Current Production Notes

- App Proxy HMAC validation is enabled when `SHOPIFY_APP_PROXY_SECRET` is set.
- Post-purchase upsell currently creates a separate Shopify order. If you want
  upsells merged into the original order, use Shopify order editing or a
  fulfillment-side merge rule after deployment.
