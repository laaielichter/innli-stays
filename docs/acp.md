# ACP checkout sessions and card guarantees

The Agentic Commerce Protocol (ACP, by OpenAI and Stripe) lets an agent platform complete a purchase at a merchant: checkout sessions, and a single-use payment token the platform was granted for that purchase. INNLI serves ACP on every installation, next to MCP, REST and UCP.

ACP was designed for goods. An item is an id and a quantity; there are no dates, guests or rooms. INNLI bridges that with what it already has: **a quote**.

## In short

- Discovery: `GET /.well-known/acp.json`. Endpoint: `/acp`.
- An **item id** is either a `quoteId` from `search_stays` or `get_quote`, or a stay written out: `property:unit:checkin:checkout:adults[:children[:dogs[:ratePlan]]]`, for example `prop_spaarne:standaard:2027-05-01:2027-05-03:2`. `quantity` is the number of identical rooms.
- A session holds the rooms for 15 minutes (`expires_at`). Up to three room types at one property, with the same dates.
- Completing a session sends the same request as `request_booking`: same consent hash, hold limits and signed record.

## Operations

| Operation | Call |
|---|---|
| Create | `POST /acp/checkout_sessions` → 201 |
| Update | `POST /acp/checkout_sessions/{id}` (items, buyer, fulfillment_details) |
| Retrieve | `GET /acp/checkout_sessions/{id}` |
| Complete | `POST /acp/checkout_sessions/{id}/complete` |
| Cancel | `POST /acp/checkout_sessions/{id}/cancel` (405 once completed or canceled) |

Headers, as ACP prescribes: `API-Version` (`2026-04-17` or `2026-01-16`), `Idempotency-Key` on every POST (missing: 400; reused with another body: 422; still in flight: 409), and optionally `Request-Id`, which is echoed. Errors are flat: `{ type, code, message, param }`.

## What a session says

- `line_items[]` with `base_amount`, `discount`, `subtotal`, `tax` and `total` in minor units; `total = subtotal + tax`.
- What a buyer must see about a stay travels as `custom_attributes` (check-in, check-out, guests, rate, cancellation) and `disclosures` (non-refundable; not all mandatory costs known).
- `fulfillment_options`: one digital option, *confirmation by e-mail*. A stay is not shipped.
- `status`:
  - `not_ready_for_payment`: a buyer with first name, last name and e-mail is still needed;
  - `ready_for_payment`;
  - `in_progress`: completed by the platform, the host still decides. Not a booking yet;
  - `completed`, with `order { id, checkout_session_id, permalink_url }`;
  - `canceled`.
- A property that takes bookings in its own booking system cannot be completed here: the session carries an `intervention_required` message with the link for the buyer.

## Paying

**Without a payment handler** (the default) nothing is charged through the platform. `capabilities.payment.handlers` is empty, the session says what the guest pays the property and when, and the platform completes without `payment_data`.

**With a payment handler** the property takes a card guarantee on its own account:

1. **Authorise** at completion, with the delegated payment token from `payment_data`. Nothing is taken yet. A declined card makes no request.
2. **Capture** when the host confirms, or at once with instant booking.
3. **Release** when the host declines, the request expires or it is withdrawn.

The amount is the deposit when the host asks one, otherwise the whole stay. The session's `io.innli.card_payment` shows `authorized`, `captured`, `released` or `failed`. INNLI holds no money and stores no card data: the property is the merchant of record, and only the provider's reference is kept with the booking.

A refund after a captured payment is the host's to make, under the cancellation terms agreed at booking.

### Stripe (experimental)

Set the property's own Stripe secret key:

```
INNLI_STRIPE_SECRET_KEY=sk_live_...
INNLI_STRIPE_ACCOUNT=acct_...     # optional, shown to platforms as merchant_id
```

The handler is `card_tokenized` (`dev.acp.tokenized.card`). It creates a PaymentIntent with `capture_method=manual` and the shared payment token, then captures or cancels it.

**This handler is written against Stripe's published API and tested against a stand-in, not against Stripe itself.** Try it with a Stripe test key before taking real payments. 3D Secure is not supported yet: a card that needs it is refused with `requires_3ds`.

## What is not there

- ACP order webhooks (`order_create`, `order_update`). Status changes are available through the session, and through INNLI's signed callbacks.
- ACP request signatures (`Signature` and `Timestamp` headers). Identity works through agent keys, OAuth and Web Bot Auth.
- ACP over MCP.
