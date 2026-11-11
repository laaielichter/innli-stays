# Changelog

Nederlands: [CHANGELOG.nl.md](CHANGELOG.nl.md).

## 2.2.0 - 2026-11-11

### Camper rental
- New property type **camper rental**, for companies that rent out motorhomes and campervans. Its passport asks about the rental (minimum driver age, years with a licence, deposit, insurance and deductible, kilometres, abroad, fuel, pick-up and return) and about each vehicle (seats with a belt, licence category, transmission, toilet, shower, winter use and more), and leaves out what only a place to stay has.
- `search_stays` has **`kind: "camper"`**. Campers and places to stay are never mixed. Eight new requirements, such as `automatic_transmission`, `car_licence_ok`, `toilet_on_board` and `unlimited_km`.
- `get_quote` takes a **`driver`** (age, licence category, years held). The quote has a `rental` block: kilometres included for this rental, the deposit (not part of the total), insurance, pick-up and return, whether this driver may rent this vehicle, and which rules the company did not state.
- The consent summary and hash include the rental terms: a changed deposit after the guest agreed gives `TERMS_CHANGED`.
- `request_booking` refuses a camper request without a driver, and one where the driver or party breaks a rule (new error code `DRIVER_NOT_ELIGIBLE`). The driver's details are stored with the request and removed with the guest's personal data.
- No tourist tax line for campers. The sample data has a camper rental company with three vehicles.
- Details: [docs/campers.md](docs/campers.md).

### Starter packs for small owners
- When setting up, an owner can choose a **starter pack**: *B&B with two rooms*, *One holiday home*, *One campervan* or *One family motorhome*. The pack creates the rooms or vehicles and fills the passport with what is usual for that kind of business.
- Everything a pack fills in is a **suggestion** (not confirmed, source `starter`). It never replaces a confirmed fact, and it never suggests a price, deposit or fee. The owner checks each one and presses "Correct".
- An existing property can apply a pack of its own type from the Passport tab (`POST /api/owner/starter-pack`); the list is at `GET /api/starter-packs`.

### Website in ten languages
- The website is in English (the default), Dutch, German, French, Spanish, Italian, Portuguese, Polish, Japanese and Chinese, with a language picker and `hreflang` links. `site/index.html` is the only page edited by hand; `npm run site` writes the others from `site/i18n/<lang>.json`. The translations were made by machine and have not been checked by native speakers.
- The reply guard reads ten languages (the same list).

### The reply guard
- New agent tool **`check_reply`** (MCP and REST): checks what an agent is about to tell the guest against what the stay actually returned. It blocks a booking that is not one yet, an amount the stay never gave, an unconfirmed or unknown fact told as certain, and a price without its disclosure. No language model; nothing is stored. Drafts in ten languages: English, Dutch, German, French, Spanish, Italian, Portuguese, Polish, Japanese and Chinese.
- **`npm run grade -- conversation.json`** scores a whole conversation from 0 to 100, including a booking request without a clear yes from the guest. Usable as a test of a booking agent.
- There are now 20 tools; the core profile still has 8.
- Details: [docs/reply-guard.md](docs/reply-guard.md).

### INNLI Pro
- A separate, closed-source add-on for agent platforms, included with the Company licence: all-or-nothing trips across several stays. It is not in this repository.

### ACP checkout sessions and card guarantees
- **Agentic Commerce Protocol** (OpenAI and Stripe) at `/acp`, with discovery at `/.well-known/acp.json`: create, update, retrieve, complete and cancel a checkout session. An item id is a `quoteId`, or a stay written out as `property:unit:checkin:checkout:adults`.
- Completing a session sends the same request as `request_booking`, with the same consent hash, hold limits and signed record.
- **Card guarantees** through a payment handler: the card is authorised at completion, captured only when the host confirms, and released when the host declines or the request expires. A declined card makes no request. INNLI holds no money and stores no card data.
- An experimental **Stripe** handler (`INNLI_STRIPE_SECRET_KEY`). It is tested against a stand-in, not against Stripe itself. Without a handler nothing changes: the guest pays the property.
- Details: [docs/acp.md](docs/acp.md).

### Licensing and ownership
- Commercial licences have **fixed prices** (€ 2,500 or € 9,500 a year) and a short agreement in plain language. A takeover of the whole project goes by written offer. Contact is in writing.
- The licence does not change: AGPL-3.0, with a commercial licence for companies.
- The README and website no longer say the project "runs on donations" or make promises about the future. They state what is true now: free to run yourself, no commission, no selling data, no paid places in search results.
- New: [TRADEMARK.md](TRADEMARK.md) (the licences cover the code; the name and logo have their own rules), [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) (every run-time dependency and its licence) and [docs/for-companies.md](docs/for-companies.md) (what the project consists of, for a company that wants to license it or take it over).

## 2.1.0 - 2026-11-11

Knowing which agent is calling, holding rooms without abuse, and booking sessions that follow UCP. The research into what others offer and what is still unsolved is in [docs/agents-2.1.md](docs/agents-2.1.md).

### Agents prove who they are
- **Web Bot Auth** (HTTP Message Signatures, RFC 9421): a platform signs its requests with a key on its own domain. INNLI verifies that, without an account or a shared secret.
- A verified platform gets its **own limit** of 600 requests a minute.
- The verified domain is in the **signed booking record** (`consent.agentIdentity`, `consent.agentDomain`).
- The `x-innli-agent-identity` response header says how the caller was recognised, or why a signature was not valid.
- New rule for owners: **Identified agents only**. Anonymous agents can then search and ask for prices, but cannot send requests (`AGENT_IDENTITY_REQUIRED`).
- INNLI publishes its own keys at `/.well-known/http-message-signatures-directory` and signs status callbacks with RFC 9421 too.

### Through the INNLI guide
- The guide verifies agents' signatures and **signs every request it passes on**, with the caller's name, verified domain and a hashed identifier.
- An installation trusts this only from its own guide (`INNLI_GIDS_URL`). A verified platform stays verified this way, and limits count per caller instead of for the whole guide.
- New for anyone running a guide: `GIDS_PUBLIC_URL`. The guide's key is stored next to the data file (`gids.signing-key.pem`).

### Holds without abuse
- **Limit on open requests** per holder and per property: 2 for an anonymous address, 25 for an identified agent, 3 per guest e-mail address (`LIMIT_REACHED`).
- An anonymous agent cannot hold more than half of the rooms at once.
- Anonymous agents are counted **per address**. Before, they shared one limit and one caller could block the rest.
- **Short holds** (`get_quote` with `hold`, UCP sessions) also count per caller: 3 at a time for an anonymous address, 60 for an identified agent.
- New in the dashboard: **Agents and their behaviour**. Per agent you see quotes, requests, bookings and what expired or was cancelled.

### Booking sessions that follow UCP (draft)
- A profile at `/.well-known/ucp` and a REST address at `/ucp/v1` with `booking-sessions`: create, read, update, complete and cancel.
- The same five operations as MCP tools at `/ucp/mcp`, for platforms that speak UCP over MCP.
- Totals in the smallest currency unit, payment terms (deposit, the rest on site) and cancellation conditions with `refundability`.
- Completing sends the same request as `request_booking`, with the same consent hash and the same record.
- The standard is a draft: `INNLI_UCP_VERSION` sets the version.

### Reliable retries
- **`Idempotency-Key` header** for REST tools and UCP: a repeated request gets the first answer (`Idempotent-Replayed: true`); the same key with different content gives `409`. For `request_booking` the key is also stored with the request.

### Check it yourself
- **`npx innli-conformance <address>`** (or `npm run conformance -- <address>`): 13 checks that only read and book nothing. Meant for agent platforms, owners and anyone who wants to test an installation.

### Cancelling
- Every quote has **`cancellation`**: `refundability`, `freeUntil` and what cancelling costs today. `unknown` if the owner only has a text.

### For agent builders
- `agent-kit/examples/`: a Web Bot Auth signer and the whole booking flow over REST, without dependencies.
- The idempotency cache now runs after identification and rate limiting.
- A signed record always names its key: the installation id, or the key's thumbprint.
- New: [SECURITY.md](SECURITY.md), with how to report a vulnerability and how to run INNLI safely.

### Hardened after an independent review
- A signature only counts for this installation's own public host (`INNLI_PUBLIC_URL`), never for a host name the caller sends. A signed `Content-Digest` is compared with the body.
- Requests relayed by the guide must be single use (nonce), valid for at most five minutes, and signed with method and path.
- `modify_request` counts as a hold and records its holder; `ask_host`, `join_waitlist` and `report_data_issue` follow the *identified agents only* rule too.
- Idempotency keys are scoped to the caller, so two anonymous agents never get each other's request.
- UCP: a session opened by an identified caller is only visible to that caller; a failed update leaves the session and its holds untouched; per-stay totals add up exactly, also with discounts; rooms on different rate plans get their own cancellation terms.
- Short holds are counted per room.
- New: `INNLI_TRUST_PROXY` (default `1`). Set it to `0` when the installation is reachable directly from the internet. For a guide: `GIDS_TRUST_PROXY`.

### Note when moving from 2.0
- `LIMIT_REACHED` now gives status 429 over REST instead of 400.
- An anonymous agent can have only 2 requests open at a time per property. Platforms that work for many guests: sign your requests or use a key.
- There is a new file next to the data, `innli.booking-sessions.jsonl`. Include it in your backup.

## 2.0.0 - 2026-10-19

Agents and stays find each other. We looked into where things go wrong most between AI agents and accommodations, and solved the ten biggest problems. The research and the sources are in [docs/agents-2.0.md](docs/agents-2.0.md).

### Supply and demand
- **Stay wishes** (`post_stay_wish`, `get_wish_offers`, `withdraw_stay_wish`):
  - an agent leaves an anonymous wish, without a name or contact details;
  - stays that fit answer straight away;
  - owners see the wish in the new *Wanted* tab and make an offer, optionally with a one-time discount;
  - the agent gets a fresh price with every offer, and a signed message through `callbackUrl`;
  - through the INNLI guide, one wish goes to all installations nearby.

### Faster and leaner for agents
- **Core profile** (`/mcp?profile=core`): 8 tools and short instructions. That is about 49% less context per turn.
- **`detail: "brief"`:** the same facts in about 70% fewer tokens.
- **Compact JSON.**
- **`npm run measure`** shows the numbers.
- **`nextActions`:** the next calls with prefilled arguments, with what is still needed from the guest.
- **`freshness`:** how long an answer can be relied on, and how old the underlying calendar is.
- **`timeBudgetMs` for `search_stays`:** slow booking systems no longer hold up the rest.

### Reliable
- **Typed errors:** `code`, `retryable`, `retryAfterSeconds`, `hint` and `nextTools`, in MCP and REST. REST now gives fitting HTTP statuses; `error` stays the readable message.
- **RateLimit headers** on every agent answer, and a structured 429.
- **Consent with a hash:**
  - every quote has `consent.summary` and `consent.hash`;
  - if the terms have changed in the meantime, nothing is sent (`TERMS_CHANGED`);
  - what the guest approved is in the signed record.

### Trust and safety
- **Website verification** with a meta tag or a file. The WordPress plugin (2.0.0) adds the tag automatically.
- **Trust block** (`trust`) with every result: level, verified domain, real reviews, warnings and safe payment.
- **Signed passport:** can be verified with the key in `/.well-known/innli.json`.
- **Protection against hidden instructions:**
  - INNLI removes instruction-like sentences and invisible characters from texts by owners and guests, before an agent reads them;
  - agents see what was removed (`contentSafety`);
  - owners see which sentences they need to rewrite.

### Discoverability
- `/.well-known/agent-card.json`, `/.well-known/mcp.json` and `/llms.txt`, on every installation and on the guide.
- `agent-kit/` with a Claude plugin (skill `find-stay`) and `server.json` for the MCP registry.

### Research
- INNLI is set up as an open research project ([research/](research/README.md)), with six research questions, measurement methods, first results and draft applications for funds.
- A labelled test set against prompt injection (`npm run research:injection`): 30 of the 30 attacks caught, 0 of the 40 ordinary sentences cut.
- The evaluation found two bugs in the text filter, which are now fixed:
  - a markdown link to a malicious site was missed;
  - numbers and links in cut texts got mangled ("8.00" became "8. 00").

### Open source
- INNLI is now open source under the [GNU AGPL-3.0](LICENSE), with a [commercial licence](COMMERCIAL.md) for anyone who wants to build INNLI into closed software. The agent-kit is MIT, the WordPress plugin stays GPL. Contributions fall under the [CLA](CLA.md).
- The public INNLI guide lists every installation for free. A licence key is no longer needed.
- Anyone running their own guide can still list only installations with a key, with `GIDS_LICENTIE_VEREIST=1`.

### Note when moving from 1.x
- There are 19 tools instead of 16.
- Error results now also have `structuredContent.error`.
- REST errors have a fitting status instead of always 400: 404, 409, 410, 429 and more.
- Text answers from MCP are compact JSON.

## 1.1.0 - 2026-10-06

15 new features.

### More bookings
- **Priced options:** bike rental, packed lunch, late check-out, cot.
  - The price applies per stay, night, person, person per night or room per night, with a maximum.
  - They can be chosen in `get_quote`, in the request and on the stay page.
- **Discount codes:** secret, not case-sensitive, with an end date, a minimum number of nights and a maximum number of uses.
- **Arrival rules:** arrival days per season or per room (e.g. Saturday to Saturday) and a supplement for one night.
- **Alternatives when full:** available stays nearby (first within 30 km, then in the country), with a price.
- **Honest scarcity:** `fewLeft` when 2 or fewer rooms are left, and the number of checks by agents for the same dates.

### Trust
- **Reviews per aspect:** cleanliness, breakfast, quiet, location, value for money and host. The averages are in the details, the search results, the comparison and on the stay page.
- **Cancellation costs calculated:**
  - a schedule with every price;
  - the cost of cancelling now in `check_status` and `cancel_request`;
  - non-refundable costs 100%.
- **House rules and sustainability as data:**
  - smoking, parties, quiet hours and minimum age;
  - eco-label, green electricity, charging point and reachable without a car;
  - new search requirements, and the answer assistant knows them.

### Convenience for the owner
- **Photo upload:**
  - JPEG, PNG or WebP, checked on the content, up to 6 MB;
  - a warning for a vague description.
- **Calendar and export:** a secret booking calendar (iCal) for Google, Apple or Outlook, and a CSV export for Excel, protected against formulas.
- **Figures:** occupancy per month and revenue per channel (agents, stay page, own website).
- **Backups:**
  - automatic, daily to a second folder (`INNLI_BACKUP_DIR`, `INNLI_BACKUP_KEEP`);
  - restore from the dashboard.

### Reach
- **Beds24 connection (API V2):**
  - reads live availability, prices and minimum stay;
  - still to be tested with a real Beds24 account: the API was built from the public description and tested against a mock Beds24.
- **OAuth 2.1 for agent platforms:**
  - metadata, dynamic registration and PKCE;
  - the owner approves when agent keys are required.
- **Status callbacks:** `request_booking` takes a `callbackUrl`; every status change goes there, signed with Ed25519.
- **Flexible search across all stays:**
  - weekend, long weekend or midweek;
  - a maximum price per night.

## 1.0.1 - 2026-10-06

WordPress plugin, tested in WordPress 7.1.3:
- **INNLI address:**
  - The address starts empty instead of with a central address that buyers do not use.
  - As long as it is not filled in, the dashboard and the plugin page say what needs to be done.
  - An address like `https://…/dashboard/` is cleaned up automatically.
- **Connection test:** the settings page tests the connection live and says why it fails: address unreachable, unknown accommodation ID or not published.
- **Request form:** grows and shrinks with its content, without a scrollbar inside it. For this, the stay page reports its height to the website.
- **`[innli_facts]`:** gets a tidy two-column layout that follows the theme.
- **Plugin list:** there is a *Settings* link next to *Deactivate*.

## 1.0.0 - 2026-10-06

First stable version. Licence keys cover versions released within their update period; 1.0.0 is the base from which that period counts.

### For agents
- An MCP server and REST with OpenAPI 3.1. There are 16 tools:
  - **search and compare:** `search_stays`, `compare_stays`, `get_stay_details`;
  - **availability:** `check_availability`, `find_available_dates`, `get_availability_calendar`;
  - **price:** `get_quote`, with several rooms, rate plans and a 15-minute hold;
  - **booking:** `prepare_booking`, `request_booking`, `modify_request`, `cancel_request`, `join_waitlist`;
  - **contact:** `answer_question`, `ask_host`, `report_data_issue`, `check_status`.
- Every fact has a status: confirmed, not confirmed or unknown. Unknown is never filled in.
- A price always states whether all mandatory costs are included.
- Booking records are signed with Ed25519.
- One address for all installations through the INNLI guide.

### For owners
- **Dashboard** in Dutch and English.
- **Accommodation passport** and import of details from the owner's own website.
- **Availability:** INNLI's own room calendar, iCal calendars or a live booking system.
- **Rates:** seasons, a weekend supplement, discounts and rate plans.
- **Requests:** instant confirmation, a deposit, the waiting list and reviews.
- **Answer assistant:** answers guest questions only from confirmed details and the FAQ.
- **Stay page** in four languages, with *Ask us*.
- **WordPress plugin.**
- **Currencies:** 15 currencies. INNLI never converts.

### For hotels
- Room types with several rooms and stop-sell.
- Staff keys for reception and manager.
- Signed webhooks to a PMS or channel manager.
- Licence packages Hotel and Hotel group.

### Sales
- One-time licences from € 99 to € 1,499.
- A sales package (zip) that runs without `npm install`.
- A Docker image for x86 and ARM.
