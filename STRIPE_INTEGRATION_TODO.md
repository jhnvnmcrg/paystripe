# Stripe Integration TODO

The lab already had one Checkout Session call: `createLabCheckoutSession` in
[src/lib/stripe/checkout.server.ts](src/lib/stripe/checkout.server.ts). Every module goes through it.
That call now includes the Checkout Studio settings below. No other code changed.

## Values to Replace

None of the values in the call are placeholders.

- `success_url` and `cancel_url` are real. The wrapper builds them from `APP_URL` plus each module's `successPath` / `cancelPath`, and appends `?session_id={CHECKOUT_SESSION_ID}` to the success URL.
- `mode` and `line_items` aren't set in the wrapper. Each module passes them in `params` when it calls `createLabCheckoutSession` or `startOrderCheckout`. No module has been built yet, so nothing passes them so far.

When you build each module, check these:

**Files where modules pass `mode` and `line_items`:**
- [src/lib/stripe/orders.server.ts](src/lib/stripe/orders.server.ts) (`startOrderCheckout`, for one-time purchases)
- Each module's server function that calls `createLabCheckoutSession` directly (not built yet)

| Field | Current Value | What to Set |
|-------|--------------|-------------|
| mode | not set yet (each module passes it) | `"payment"` for one-time charges, `"subscription"` for recurring billing. |
| line_items[].price | not set yet (each module passes it) | Price IDs from `npm run stripe:seed`, looked up by lookup key, or from the [Dashboard](https://dashboard.stripe.com/test/prices). |

## Configured Parameters

These parameters come from Checkout Studio. They're applied as defaults in `studioDefaults`, before `...options.params`, so a module can override one when its flow needs it (downloads turns on `allow_promotion_codes`).

**Files containing these parameters:**
- [src/lib/stripe/checkout.server.ts](src/lib/stripe/checkout.server.ts)

| Parameter | Value |
|-----------|-------|
| ui_mode | `hosted_page` (the installed `stripe` SDK is 23.0.0, which is 21.0.0 or later) |
| billing_address_collection | `auto` |
| phone_number_collection | `{ enabled: false }` |
| automatic_tax | `{ enabled: false }` |
| allow_promotion_codes | `false` |
| submit_type | `auto` (set only when `mode` isn't `setup`, because Stripe rejects it in setup mode) |
| payment_method_collection | `always` (set only when `mode` is `subscription`) |
| integration_identifier | One label per module, such as `lab-downloads-hwjpexna` (Studio's single `hosted_mobile_app_0002` was replaced) |
| origin_context | `web` (Studio set `mobile_app`; the lab opens Checkout in a normal browser tab) |

### Resolved in step 2

1. **`origin_context`** is now `web`.
2. **`integration_identifier`** is per module again, so flows can be compared in the Dashboard.
3. **`allow_promotion_codes` and `automatic_tax`** are defaults a module can override. Downloads turns on promotion codes for `LAUNCH20`.

`customer`, `metadata` and the module's own `params` aren't Checkout Studio settings, but they're still in the call. They link the session to the Clerk user's Stripe Customer and route webhook events back to the right module.

## Setup

Environment variables are in `.env.local` (`.env.example` lists them). They're server-only, so none have the `VITE_` prefix. Hosted Checkout is a redirect, so the browser never needs a publishable key.

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | A sandbox restricted key (`rk_test_...`). `getStripe()` refuses live keys. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...`, printed by `npm run stripe:listen` |
| `APP_URL` | The base URL Checkout returns to (`http://localhost:3000` in dev) |

The Stripe client doesn't pass an API version, so it uses the version that `stripe@23` pins.

To run locally:

```sh
npm install
npm run stripe:seed     # create the lab's products and prices in your sandbox
npm run stripe:listen   # forward webhooks to /api/stripe/webhook (needs the Stripe CLI)
npm run dev
```

## Files changed

- [src/lib/stripe/checkout.server.ts](src/lib/stripe/checkout.server.ts): Checkout Studio parameters added as overridable defaults; per-module `integrationIdentifiers` kept.
- [STRIPE_INTEGRATION_TODO.md](STRIPE_INTEGRATION_TODO.md): this file.

## How the flow works

1. A module page calls a server function, which calls `startOrderCheckout` (one-time purchases) or `createLabCheckoutSession`.
2. The wrapper gets or creates the Clerk user's Stripe Customer and creates the Checkout Session. It records the session in `pay_checkout_sessions` so the webhook knows which module owns it.
3. The browser goes to `session.url`, the page hosted by Stripe.
4. After payment, Stripe sends the buyer to `successPath?session_id=...` and sends `checkout.session.*` events to `/api/stripe/webhook`.
5. The webhook passes the event to the module that owns the session. For orders, `markOrderPaid` marks the order paid and copies its line items. Fulfillment happens only in the webhook, never on the success page.

## Testing

Use any future expiry date, any CVC and any postal code.

| Card | Result |
|------|--------|
| `4242 4242 4242 4242` | Succeeds |
| `4000 0025 0000 3155` | Asks for 3D Secure authentication |
| `4000 0000 0000 9995` | Declined (insufficient funds) |

More test cards: https://docs.stripe.com/testing

## Next steps

- When you build each module, pass its `mode` and `line_items` (Price IDs from the seed script) in `params`.
- Add each module's fulfillment to its handler in `src/lib/stripe/webhooks/modules.server.ts`.
- Track orders in the `pay_orders` and `pay_order_items` tables, which already exist.

## Resources

- https://support.stripe.com
- https://docs.stripe.com/mcp
