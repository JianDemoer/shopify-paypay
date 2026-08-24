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
- Existing Stripe webhook to create Shopify Admin orders after payment succeeds
- Shopify order tags/note attributes for `payment_intent`, `checkout_session`,
  `cid`, source URL, shipping method, and UTM attribution
- Optional Meta CAPI and TikTok Events API Purchase tracking after Shopify
  order creation succeeds

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

SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_xxx
SHOPIFY_APP_PROXY_SECRET=your_shopify_app_secret

META_PIXEL_ID=123456789
META_ACCESS_TOKEN=EAAB...
TIKTOK_PIXEL_ID=C...
TIKTOK_ACCESS_TOKEN=act....
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
/checkout/success?checkout_session_id=:sessionId&cid=:cid
```

If you later add post-purchase upsell, change the PaymentElement `returnUrl`
to an upsell route, for example:

```text
/a/s/checkout/:sessionId/upsell?cid=:cid
```

## Ad Tracking Flow

After `payment_intent.succeeded`:

1. The webhook verifies the Stripe signature.
2. The webhook creates a paid Shopify Admin order.
3. The order is tagged with `payment_intent:...`, `checkout_session:...`, and
   `cid:...`.
4. The same webhook sends server-side Purchase events to Meta/TikTok when the
   corresponding environment variables are configured.

## Current Production Notes

- Checkout sessions are stored in memory for the first development version.
  Replace `lib/checkout-sessions.ts` with Redis/Postgres before production.
- App Proxy HMAC validation is enabled when `SHOPIFY_APP_PROXY_SECRET` is set.
- Post-purchase upsell can be added between Stripe success and final
  confirmation, or as a separate offer route keyed by PaymentIntent ID.
