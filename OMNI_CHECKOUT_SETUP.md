# Shopify App Proxy Checkout

This fork adds an OmniSecure-style custom checkout flow on top of the original
Next.js Shopify + Stripe project.

## What Is Included

- Shopify Theme App Extension App Embed: `extensions/omni-checkout`
- Product-page takeover script fallback: `/assets/opc-bootstrap.js`
- Checkout session API: `POST /api/checkout/session`
- Session lookup API: `GET /api/checkout/session/:sessionId`
- App Proxy-style checkout route: `/a/s/checkout/:sessionId/entry?cid=...`
- Three-step checkout UI:
  - Contact
  - Shipping
  - Payment
- Stripe PaymentElement for PCI-safe card collection
- PayPal JS SDK checkout with server-side capture and Shopify order creation
- Stripe webhook to advance payments and finalize the Shopify order after the Funnel completes
- Shopify order tags/note attributes for `payment_intent`, `checkout_session`,
  `cid`, source URL, shipping method, and UTM attribution. Shopify's native
  pixel/channel integrations can use the resulting Shopify order for ad
  attribution.
- Durable checkout sessions through Upstash Redis REST in production, with
  local file storage fallback for development
- Post-purchase upsell route after the main Stripe payment succeeds
- Versioned Funnel step graph with Checkout Zones, stable weighted routes, Downsell branches, and permalink routes
- Stripe off-session post-purchase payment using the saved Stripe PaymentMethod; accepted offers are bundled into the original Draft Order
- Shopify OAuth installation, App Proxy configuration, uninstall webhook, event storage, and checkout reports

## Local Run

```bash
npm install
./start.sh
```

The start script uses the installed dependencies directly and never runs an implicit install.
It writes development compiler output to `.next-dev`; production builds continue to use `.next`.

For local/admin tooling, create a checkout session directly:

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

## Shopify App Installation Is the Store Connection

The Shopify app installation is the runtime connection for a store. After the
OAuth callback succeeds, the app automatically persists the store domain, the
Shopify Admin OAuth access token, the authorized scopes, and the App Proxy
verification secret. The checkout and catalog routes resolve the store from
Shopify's signed App Proxy request; they do not depend on a merchant manually
copying Shopify tokens into `/admin/stores`.

The Admin API is the default catalog channel after installation. A Storefront
API token is optional and is only needed for the optional Storefront cart
mutation helpers. It is never required for the App Proxy checkout session,
server-side variant pricing, Draft Order creation, or order finalization.

## Runtime Environment

```bash
# Optional global operator token for cross-store administration. Merchant
# sessions are created automatically after each store's Shopify OAuth install.
# ADMIN_CONFIG_TOKEN=change_this_token
# Optional dedicated merchant-session signing key. SHOPIFY_API_SECRET is used
# when this is omitted.
# ADMIN_SESSION_SECRET=change_this_to_a_long_random_value
SHOPIFY_API_KEY=your_shopify_app_client_id
SHOPIFY_API_SECRET=your_shopify_app_client_secret
SHOPIFY_APP_URL=https://your-app.example.com
CONFIG_ENCRYPTION_KEY=change_this_to_a_long_random_value
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
# Strongly recommended in production: schedules Draft Order finalization after
# an abandoned post-purchase offer. Without it, the success page and daily
# Vercel Cron remain as fallbacks, so an abandoned offer can take longer to
# finalize.
QSTASH_TOKEN=...
```

Optional fallback single-store variables can still be set in `.env.local` for
local development. They are not the normal production installation path.
For multi-store usage, each store is created automatically when it installs
the Shopify app. `/admin/stores` is only for optional commerce settings:

```text
/admin/stores
```

Per store, fill:

- Shopify connection: managed by the app installation
- Storefront token: optional; not required by checkout
- Stripe publishable key, secret key, and webhook secret when Stripe is used
- PayPal client ID and secret when PayPal is used
- Order mode: Draft Order or Direct Order. Both flows use Shopify Admin GraphQL.
- Upsell product and variant GIDs
- Checkout Zones and Funnel Versions JSON in the admin page

## Shopify Theme Injection

The preferred production path is the Theme App Extension included in this
repository. It is delivered with the Shopify app and is the product-page
injection path; installation and OAuth connection do not depend on the admin
configuration page. Deploy the extension with Shopify CLI so it is available
to installed stores:

```bash
shopify app dev
# or, for a deployed release:
shopify app deploy
```

The embed listens for product-page checkout buttons and calls the configured
App Proxy. It does not load card fields or handle payment credentials.

For a theme that has disabled the embed, enable **Omni Checkout** once under
**Online Store -> Themes -> Customize -> App embeds**. This is a theme-level
activation, not a Shopify token or store configuration step. A legacy theme can
also load the same asset explicitly:

```html
<script src="https://YOUR_APP_DOMAIN/assets/opc-bootstrap.js" defer></script>
```

The script intercepts product-page checkout buttons, creates a checkout session,
and redirects the buyer to:

```text
/a/s/checkout/:sessionId/entry?cid=:clientId
```

The script creates sessions through the App Proxy API route:

```text
/a/s/api/checkout/session
```

This keeps the product-page request on the Shopify store domain and avoids
cross-origin browser requests. The Shopify App Proxy secret captured during
installation verifies Shopify's App Proxy signature before creating the
checkout session.

In production, App Proxy routes use the secret captured from the Shopify app
installation. Missing secrets are allowed only during local development.

The direct `/api/checkout/session` route is a public storefront entry point for
the configured single store. It is protected by server-side variant/price
resolution, the production store allowlist (`CHECKOUT_PUBLIC_STORE_ID` or
`NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN`), and rate limiting. It does not accept an
admin token because a browser product page must be able to call it. Store
management endpoints under `/api/admin/*` remain protected by
`ADMIN_CONFIG_TOKEN`.

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

Payment amounts and line items are recalculated from the server-side checkout
session. The payment APIs do not trust buyer-controlled `amount` or `lineItems`
values from the browser.

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

If the buyer declines an offer, the configured Funnel decline edge is followed. It can lead to a Downsell or Thank You step.

If the buyer completes the Funnel, they continue to:

```text
/a/s/checkout/:sessionId/success?checkout_session_id=:sessionId
```

If the buyer accepts an offer, Stripe confirms a second PaymentIntent with the
saved PaymentMethod. The server never receives PAN or CVC. The accepted item is
added to the original Draft Order before it is completed, so the final Shopify
order contains the main items and all accepted offers.

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

## Shopify Attribution

This project does not send Meta/TikTok events directly. Attribution data is
kept on the Shopify order and in the internal event store. An external custom
checkout should not assume that creating an Admin order automatically fires
Shopify's browser `checkout_completed` event; validate any Shopify Customer
Events pixel or channel behavior with a real order.

After payment succeeds:

1. The webhook verifies the Stripe signature.
2. The webhook marks the payment as paid and advances the Funnel state.
3. At Thank You, the app updates and completes the single Draft Order (or creates one direct order).
4. The order is tagged with `payment_intent:...`, `checkout_session:...`, and
   `cid:...`.
5. The order note attributes include UTM, source URL, checkout session, and
   shipping method for backend attribution and reporting.

## Draft Order Finalization

The primary payment creates a Draft Order before card confirmation. The app
waits briefly for post-purchase offers, then updates and completes that same
Draft Order. A completed funnel finalizes immediately. When a buyer abandons
an offer page, QStash schedules the same idempotent finalization endpoint for
the configured grace period (`CHECKOUT_FINALIZATION_GRACE_SECONDS`, default
15 minutes). The customer success page retries an overdue finalization, and
the daily Vercel Cron is a final recovery path.

Fixed `taxRate` values are represented as a non-shippable `Tax` adjustment in
Draft Order mode, while product prices use GraphQL price overrides. This keeps
the Shopify Draft total equal to the Stripe or PayPal amount. For automated
Shopify tax calculation instead of a fixed tax rate, set `taxRate` to `0` and
implement a store-specific tax calculation policy before enabling tax charges.

For multi-store setups, the Shopify store used for order creation is the store
whose Stripe webhook secret verifies the event. PaymentIntent metadata is not
allowed to switch the order into another store.

## PayPal Flow

1. Buyer clicks the PayPal button on the contact step.
2. Browser calls `/api/payment/paypal/create-order`.
3. Buyer approves inside PayPal.
4. Browser calls `/api/payment/paypal/capture-order`.
5. The capture endpoint marks the primary payment as paid and advances the Funnel.
6. A PayPal post-purchase offer opens a new PayPal authorization. It is not a
   true one-click charge because PayPal Vault/reference transactions are not
   enabled by this implementation.
7. Accepted PayPal offers are added to the same Draft Order before completion.

## Draft Order Mode

Set:

```text
SHOPIFY_ORDER_MODE=draft_order
```

In this mode, the payment setup path creates one Shopify Draft Order before
payment. The draft stays open while post-purchase steps run. At Thank You, or
after the scheduled finalizer timeout, the app updates the draft with accepted
offers and completes it once. If `SHOPIFY_ORDER_MODE` is unset, the app creates
one direct Shopify Admin order at finalization.

## Current Production Notes

- App Proxy HMAC validation is enabled when `SHOPIFY_APP_PROXY_SECRET` is set.
- The production finalizer is exposed at `/api/cron/finalize-checkouts` and is
  scheduled by `vercel.json`. Set `CRON_SECRET` in production.
- The app does not claim that creating an Admin order automatically fires
  Shopify's browser `checkout_completed` event. External checkout pages should
  treat Shopify order tags/note attributes as backend attribution. If exact
  Meta/TikTok browser pixel behavior is required, configure the relevant
  Shopify Customer Events pixel or a server-side conversion integration
  separately and verify it with a real test order.

## Shopify App Installation

1. Replace the placeholders in `shopify.app.toml` with the deployed app URL and
   Shopify API key.
2. Set `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, and
   `SHOPIFY_OAUTH_REDIRECT_URI`.
3. Deploy the Next.js app and Theme App Extension. Run `shopify app config push`
   or `shopify app deploy` from a Shopify CLI-authenticated environment.
4. Open `/install?shop=your-store.myshopify.com` or install from the Shopify
   Dev Dashboard.
5. Complete Stripe/PayPal values and publish the store's Zones/Funnels at
   `/admin/stores`.

The OAuth callback saves the per-store Admin token encrypted at rest. The
`app/uninstalled` webhook removes that store's installation record. App Proxy
must point to `https://YOUR_APP_DOMAIN/a/s`, with prefix `a` and subpath `s`.

The OAuth installation only connects Shopify. Stripe and PayPal credentials are
intentionally left for `/admin/stores`, because they belong to the merchant's
payment accounts and are not returned by Shopify OAuth.
