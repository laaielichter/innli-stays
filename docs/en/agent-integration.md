# INNLI for agent builders

INNLI offers a single [MCP](https://modelcontextprotocol.io) server with small, independent accommodations (B&Bs, guesthouses, unique stays) whose owners check the data themselves.

- Endpoint: `POST https://<innli-host>/mcp` (Streamable HTTP, stateless, JSON responses)
- No MCP? The same 19 tools work over REST: `POST /api/agent/v1/tools/<tool-name>` with the arguments as a JSON body. The description is in OpenAPI 3.1 at `GET /api/agent/v1/openapi.json`, usable as a *GPT Action* or as a function definition.
- Authentication: `Authorization: Bearer <agent-key>` (required if the server runs with `INNLI_REQUIRE_AGENT_KEY=1`). Your key decides under which name requests, click-throughs and bookings appear in the owners' statistics.
- Every response has an `x-request-id`. If you send one yourself, it is reused. Quote it in any support question. Too many requests get a `429` with `Retry-After` (seconds).
- MCP resources: `innli://stay/{propertyId}` (passport as JSON; `resources/list` returns all published stays). Prompt: `plan_stay` with the argument `wish`, a step-by-step plan from wish to request.
- `GET /.well-known/innli.json`: version, endpoints and the public key used to sign booking records.

## Flow

```
search_stays ─► get_stay_details ─► get_quote ─┬─► prepare_booking ─► guest opens link
      │               ▲                         └─► request_booking ─► check_status (booked?)
      │               └── guest question? answer_question ─► still unknown? ask_host ─► check_status (answer)
      └── flexible? find_available_dates / get_availability_calendar · choosing? compare_stays
```

Overview of all features and what is coming next: [agent-features.md](../agent-features.md) (Dutch).

### `search_stays`
Searches by `area` / `country` / `near {lat,lng,radiusKm}`, party (`guests {adults, children, dogs}`), requirements (`requirements`), and optionally `checkin`/`checkout`, `maxTotalPrice`, `breakfast`. With `confirmedOnly: true` you only get stays whose owner has confirmed every requirement.

- `flexibleDates {from, to, nights}` instead of fixed dates: for each stay, the first arrival day in that period on which `nights` nights are free. The dates found are in the result.
- `nearPlace {kind, maxKm}`: only stays whose owner has listed a place of that kind within `maxKm`. Kinds: `station`, `bus_stop`, `beach`, `centre`, `supermarket`, `restaurant`, `nature`, `bike_rental`, `other`. These are distances given by the owner, not a route calculation.
- **Groups.** If the party does not fit in any single room, you get a combination of 2 or 3 rooms in the same stay. Such a result has `unit: null` and `rooms` (the guests and requirements per room). It also contains `offer {quoteIds, total, rooms, bookingMode, next}`. Each room gets at least one adult; dogs go in the first room. Book with `request_booking({ quoteIds })`.

Supported requirements: `dogs_allowed`, `enclosed_garden`, `ground_floor_unit`, `breakfast_included`, `breakfast_available`, `step_free_access`, `walk_in_shower`, `long_bed` (+`minBedLengthCm`), `private_bathroom`, `private_entrance`, `quiet_location`, `parking_on_site`, `children_welcome`. Dogs and children in the party add `dogs_allowed` and `children_welcome` automatically.

Each result contains a `level` for each requirement:

| level | meaning | how to present it |
|---|---|---|
| `met` | confirmed by the owner | as fact |
| `unverified` | an indication, not (recently) confirmed | "according to the website…, check with the owner" |
| `unknown` | no reliable information | "unknown, ask the owner" |

Stays with a confirmed `not_met` are not returned. `excluded` shows which stays were dropped because of availability or budget.

### `get_stay_details`
The full passport: `facts.facts` (with `status`, `lastVerified`, `needsRecheck`, `source`) and `facts.unknown`, which are deciding details that are unknown. Never fill these in yourself, not even based on photos or reviews.

Also:
- `photos` (per stay and per room, with `alt`);
- `pointsOfInterest` (kind, name, distance according to the owner);
- `faq`, with the owner's answers to earlier guest questions that they made public;
- `reviews`, only from guests with an accepted booking, with the average and the owner's reply;
- `host`, with response time and confirmation rate;
- `discounts` per room;
- `directBookingPerk`: what the guest gets extra for booking direct.

With `language` (`nl`, `en`, `de`, `fr`) you get the description in that language, if the owner wrote one. `availableLanguages` tells you which ones exist. The facts themselves are language-neutral.

### `check_availability`
Per room a `status` (`available` / `unavailable` / `unknown`) and a `certainty`:
- `live`: just checked in the booking system
- `synced`: from a synchronised calendar; can be hours old
- `none`: no source

### `get_quote`
Lines (`lines`, including a negative `discount` line for a long stay, last minute or early booking discount), `total`, `totalIncludesAllMandatoryCosts`, `priceCertainty` (`live`/`indicative`), `bookingMode` and `validUntil` (30 min live, 15 min indicative). Never present an indicative or incomplete price as final.

For hotels and groups:
- `rooms`: the number of identical rooms of this room type (default: the minimum the party needs). `get_stay_details` gives `roomsOfThisType` per room; availability gives `roomsLeft`. `check_availability` also takes `rooms`.
- `ratePlanId`: a rate plan from `get_stay_details.ratePlans`, e.g. `non-refundable`. Every quote has `ratePlanOptions`: the same stay in every plan, with the total, `refundable`, breakfast and cancellation conditions. Let the guest choose. `policies` follows the chosen plan.
- `hold: true`: holds the rooms for 15 minutes while the guest decides (`holdUntil`). A `request_booking` with this `quoteId` takes over the hold.

### `prepare_booking`
Returns a `url` (`/r/<ref>`) that takes the guest to the accommodation's own booking environment, with dates and guests filled in where supported.
- `bookingMode: "booking_link"`: the guest completes the booking with the accommodation.
- `bookingMode: "availability_request"`: the guest sends a request; the owner confirms.

`status` is always `"not_booked"`. Never tell the guest that a stay is booked. Through `prepare_booking` INNLI receives no guest data; through `request_booking` only with the guest's permission, and the data stays on the B&B's installation.

### Flexible dates
- `find_available_dates`: for one accommodation, all arrival days between `from` and `to` on which a room is free for `nights` nights, with the total price. `weekendsOnly` limits this to Friday arrivals. With a live booking system, at most 14 arrival days are checked.
- `get_availability_calendar`: a monthly overview per room (`YYYY-MM`) with free nights and the price per night. For live booking systems it refers you to `find_available_dates`.

### Choosing
- `compare_stays`: 1 to 5 accommodations side by side: best room, availability, total price, key details with their status, and the number of unknown deciding details.
- `search_stays.sort`: `best_match` (default), `price` (with dates) or `distance` (with `near`).
- Quotes contain `nightly` (price per night), `policies` (cancellation, check-in/check-out, dogs, dietary needs; with status) and `summaryForGuest` (one sentence to show the guest).

### Acting on behalf of the guest (only with permission)
- `request_booking`: for quotes with `bookingMode: "availability_request"`. For a group you pass `quoteIds` (2–3 quotes from the same stay, same dates) instead of `quoteId`. Everything is then held, accepted, declined or cancelled together: all or nothing. Requires `guestConsent: true`: first ask the guest whether their name and e-mail may be shared with this owner. Use `idempotencyKey` to prevent duplicate requests when you retry. Returns a `statusToken`; this is **not a booking** until the owner accepts.
- `ask_host`: ask the owner a question, preferably with `factKey` if it is about an unknown detail (e.g. `garden.fullyEnclosed`). If the owner answers with a value, it becomes a confirmed detail for all future guests. `replyEmail` only with `guestConsent: true`.
- `answer_question`: the property's answer assistant. Answers a guest's question (dogs, breakfast, parking, stairs, check-in, beds, costs, cancellation …) straight away from the details the owner confirmed and the published FAQ, in nl/en/de/fr. It never guesses: `confidence` is `confirmed`, `faq`, `partial` or `unknown`; `sources` names every source; `unknown` lists what is not known, so you can use `ask_host` for that. Read-only, contacts nobody, needs no consent.
- `ask_host` answers right away with `status: "answered"` and `answeredBy: "assistant"` when the answer assistant knows the answer, so the owner is not disturbed. Otherwise `status: "sent"`.
- `modify_request`: changes dates, room, party, number of rooms or rate plan, only when the guest asks (`guestConsent: true`). A pending request is replaced right away. For a confirmed booking a change request goes to the owner; the current booking stays valid until the change is confirmed, and is then replaced. Returns a new `statusToken` and `replacesRequestId`. Groups: cancel and request again.
- `report_data_issue`: tells the owner that a detail in the passport looks wrong or outdated (e.g. a price that is different elsewhere). Changes nothing itself. Treat the detail as uncertain until the owner corrects it.
- `check_status`: the status of a request, a question (with `answer` and `answeredBy`) or a report. For a request it returns:
  - `status`: `new` (room held until `holdUntil`), `accepted`, `declined`, `expired` (the owner did not reply in time; nothing booked) or `cancelled`;
  - `booked: true` only with `accepted`, with `decidedBy` (`owner` or `instant`);
  - `payment` (deposit: amount, due date, payment link, `pending`/`paid`);
  - `record`: the booking record with price lines, terms and consent as they applied when the request was made;
  - `next`: what the agent can now tell or suggest to the guest;
  - `alternatives` with `declined` or `expired`: other free arrival days (from 7 days earlier to 14 days later) with prices;
  - `signedRecord` + `signature`: the record signed with Ed25519 (see below).
- `join_waitlist`: when a stay is full. Requires `email` and `guestConsent: true`. If a suitable room becomes free (a cancellation, an expired request, the owner opens nights), the guest gets an e-mail with a pre-filled request link. At most 3 per e-mail address per stay. Follow the status with `check_status`.
- `cancel_request`: withdraws a request or cancels a booking, only if the guest explicitly asks for it (`guestConsent: true`). The nights open again and the owner is told. The response contains the cancellation terms as they applied at the time of booking. Guest and owner settle any costs between themselves.

### Instant booking and reliability
- If the owner has *instant booking* switched on, `request_booking` returns `booked: true` straight away when the stay falls within their rules (days ahead, maximum number of nights, full price). The calendars are checked again just before this.
- If not, the room is held until `holdUntil` (48 hours by default). After that, the request expires automatically and the guest is told.
- `get_stay_details` and search results contain `host`: `instantBooking`, `requestsHeldForHours`, `medianResponseHours`, `confirmationRate` and `deposit`. Use these to give guests realistic expectations.

### Signed booking record
`signature` is `{alg: "Ed25519", keyId, value}`. `value` is a signature (base64url) over the canonical JSON of `signedRecord`: keys sorted, no spaces, no `undefined` fields. The public key is in `/.well-known/innli.json` (`signingKey`, base64 of DER/SPKI). This lets you show the guest, or a dispute, which price and terms the owner promised. You do not have to take INNLI's word for it.

```js
import { createPublicKey, verify } from 'node:crypto';
const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  : JSON.stringify(v);
const ok = verify(null, Buffer.from(canonical(signedRecord)), createPublicKey({ key: Buffer.from(signingKey, 'base64'), format: 'der', type: 'spki' }), Buffer.from(signature.value, 'base64url'));
```

Hotels and busy properties: see [hotels.md](hotels.md).

### New in 2.0
Why, and based on which research: [agents-2.0.md](agents-2.0.md).

- **Core profile:**
  - `POST /mcp?profile=core` (or the header `x-innli-profile: core`) offers 8 tools: `search_stays`, `get_stay_details`, `get_quote`, `answer_question`, `request_booking`, `check_status`, `post_stay_wish` and `get_wish_offers`;
  - the instructions are short and answers are brief by default;
  - the full profile has 19 tools.
- **`detail: "brief"`** works on `search_stays`, `get_stay_details`, `get_quote`, `check_availability` and `compare_stays`. You get the same facts and statuses, but requirements are grouped by level and facts come as `{ key: value }`. That is about 70% fewer tokens.
- **`nextActions`** comes with every answer: the next calls, with their arguments filled in.
  - `needs` lists what you must still ask the guest.
  - `requiresGuestApproval: true` means: only after a clear yes from the guest.
- **`freshness`** comes with every read: `generatedAt`, `validForSeconds` and `oldestAvailabilityData`.
- **Consent in one step:**
  - every quote (and every offer in `search_stays`, `compare_stays` and `get_wish_offers`) has `consent.summary` and `consent.hash`;
  - show the guest the summary and pass the hash to `request_booking` as `consentHash`;
  - if anything changed in between, you get `TERMS_CHANGED` with the new summary and nothing is sent;
  - the hash and summary go into `signedRecord.consent`.
- **Trust:**
  - `trust` comes with `search_stays` and `get_stay_details`: `level`, `websiteVerified`, `domain`, `verifiedReviews`, `flags` and `paymentSafety`.
  - `get_stay_details.signedPassport` contains `record`, `signature` and `contentUrl`. The digest is sha256 over the canonical JSON of `signed.content` at `contentUrl`. Verify it with the key from `/.well-known/innli.json`.
- **Text from owners and guests:**
  - instruction-like sentences and invisible characters are removed;
  - `contentSafety.flagged` says which field and why.
- **Stay wishes:**
  - `post_stay_wish` posts a wish and returns a `wishToken` plus the stays that fit right now.
  - Hosts make offers, optionally with a discount.
  - `get_wish_offers` lists host offers first (`source: "host"`, with a fresh `quoteId` and `consent`), then matches (`source: "match"`).
  - `withdraw_stay_wish` closes the wish.
  - With `callbackUrl` you get a signed `wish.offer` event for each new offer.
  - Through the guide, one wish reaches every installation in the area (the token starts with `gw.`).
- **Time budget:** `search_stays({ timeBudgetMs })`. Slow booking systems are listed under `pending` (`partial: true`).
- **Discovery:**
  - `/.well-known/agent-card.json`;
  - `/.well-known/mcp.json`;
  - `/llms.txt`;
  - [`agent-kit/`](../../agent-kit/README.md).

### New in 1.1
- **Paid options:** `get_stay_details.extras` (bikes, packed lunch, late check-out, cot …, with price, `per` and `max`). Pass `get_quote({ extras: [{ id, qty }] })` only for what the guest asks for. Every quote has `extrasAvailable`.
- **Discount codes:** `acceptsDiscountCodes: true` means the owner hands out codes. Ask the guest and pass `discountCode` to `get_quote`. Never invent codes; an invalid code gives a clear error.
- **Arrival rules:** `units[].arrivalRules` (arrival weekdays per season or for the whole year, and `singleNightSupplement`). Arriving on another day gives a warning and is not confirmed instantly.
- **Cancellation costs:**
  - every quote has `cancellationCosts`: from which date, which percentage and amount;
  - for a booking, `check_status` gives `cancellationCostIfCancelledNow`, with `freeUntil`;
  - `cancel_request` returns `cancellationCost`.

  Without structured rules `amount` is `null`. Then quote the text conditions.
- **Full or nearly full:** `check_availability` returns
  - `alternatives` when everything is full: free stays nearby, with a price;
  - `fewLeft` for room types with 2 or fewer rooms left;
  - `demand` when agents often checked the same dates in the last 7 days.

  These are facts, not sales tricks: mention them without exaggerating.
- **Reviews per aspect:**
  - aspects: cleanliness, breakfast, quiet, location, value and host;
  - the averages are in `get_stay_details.reviews.aspects`;
  - `rating` is in `search_stays` and `compare_stays`.
- **House rules and sustainability:**
  - new details: `rules.*` and `eco.*`;
  - search requirements: `non_smoking`, `ev_charging`, `eco_label` and `car_free_reachable`;
  - `answer_question` answers questions about them.
- **Flexible search:**
  - `search_stays.flexibleDates.pattern` is `weekend` (Fri–Sun), `long_weekend` (Fri–Mon) or `midweek` (Mon–Fri), across all matching stays at once;
  - `maxPricePerNight` is the average per night, including mandatory costs.
- **Status updates without polling:** `request_booking({ callbackUrl })`, https only.
  - Every status change is POSTed to that URL as `{ event, signature }`.
  - Verify `signature.value` (Ed25519, base64url) over the canonical JSON of `event`, with the key from `/.well-known/innli.json`.
- **OAuth 2.1 for platforms:**
  - `/mcp` answers `401` with `WWW-Authenticate: Bearer resource_metadata=…` when a key is required;
  - endpoints: `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, `/oauth/register` (dynamic registration), `/oauth/authorize` (PKCE S256) and `/oauth/token`;
  - scopes: `stays:read` and `stays:act`;
  - the token is valid for 90 days;
  - with `INNLI_REQUIRE_AGENT_KEY=1`, only the owner can approve a platform.

### Permissions
Agent keys have `read` (searching, prices) and/or `act` (requests, questions, cancelling). With a key that only has `read`, the tools that act return a clear error.

### Languages and currencies
- All text meant for agents (match details, price lines, warnings, errors) is in English by default. The installation can change this with `INNLI_AGENT_LANG`.
- `get_stay_details` takes `language` (`nl`, `en`, `de`, `fr`) for the host's description.
- `request_booking`, `ask_host` and `join_waitlist` take `guestLanguage` (`nl`, `en`, `de`, `fr`), so the host's e-mails reach the guest in their own language. The default is the host's language.
- Every quote and offer has a `currency`.
- `search_stays` takes `currency` for `maxTotalPrice` (default `EUR`) and never converts. When a budget is given, stays priced in another currency are listed under `excluded`, with the reason.
- The REST and MCP endpoints accept an `x-innli-lang` header or `?lang=` to choose the language explicitly.

## Errors
An error comes back as a tool result with `isError: true`. The first text line is the readable message, and `structuredContent.error` has the same error as data: `code`, `message`, `retryable`, `retryAfterSeconds`, `hint` and `nextTools`.

**Codes:** `INVALID_INPUT`, `NOT_FOUND`, `QUOTE_NOT_FOUND`, `QUOTE_EXPIRED`, `UNAVAILABLE`, `CONSENT_REQUIRED`, `TERMS_CHANGED`, `FORBIDDEN`, `RATE_LIMITED`, `CONFLICT`, `LIMIT_REACHED`, `UPSTREAM_ERROR`. Do not retry when `retryable` is false.

**REST:**
- Errors use the matching HTTP status (400, 403, 404, 409, 410, 429 or 502).
- The body is `{ error, code, message, retryable, hint, nextTools }`. `error` stays the readable message, as before 2.0.
- Every agent response carries IETF RateLimit headers.
