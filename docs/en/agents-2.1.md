# INNLI 2.1: know your agent, holds that cannot be abused, and UCP lodging (research, November 2026)

For 2.1 we looked at what other projects and standards give AI agents that book accommodation, and at what is still unsolved for the sector. This page says what we found, what INNLI 2.1 does about it, and what it deliberately does not do yet.

## What others offer

| Project or standard | What an agent gets | What is missing for a small property |
|---|---|---|
| Airbnb MCP server (openbnb, community) | Search and listing details, by scraping | No booking, no host consent, no verified facts |
| Booking.com and Expedia connectors | Search; the booking finishes on their site | The property pays commission and owns neither guest nor data |
| 1Stay (Stayker) | `book_hotel` returns a hosted checkout link | A hosted intermediary with a fee |
| HemmaBo | Host-owned rentals with signed offers | Hosted, not something a property runs itself |
| Apaleo MCP | Operations for hotel staff (reservations, rates) | Not meant for a guest's agent |
| UCP lodging (draft capability `dev.ucp.lodging.booking`) | A booking-session protocol for platforms: stays, totals, policies, payment terms, completion | Needs a server at the property that speaks it |
| ACP (OpenAI/Stripe) | Checkout sessions for goods, with payment tokens | No lodging objects: dates, rooms and occupancy do not exist in it |
| AP2 (Google) | Signed mandates that prove what the buyer authorised | Needs a credential provider and a second key type |
| Web Bot Auth (HTTP Message Signatures, RFC 9421) | An agent proves who it is with a key on its own domain | The property's server has to verify it |

The gap we found: nothing self-hosted and open source lets an independent property take part in these protocols on its own terms. Everything that books goes through an intermediary.

## The five biggest open problems, and what 2.1 does

### 1. A property cannot tell which agent is calling
A user-agent string proves nothing, and asking every platform to register for a key at every B&B does not scale.

**INNLI 2.1** verifies Web Bot Auth signatures:
- The agent sends `Signature-Agent`, `Signature-Input` and `Signature` (RFC 9421, Ed25519, `tag="web-bot-auth"`). Its keys are a JWKS at `<its origin>/.well-known/http-message-signatures-directory`.
- A verified platform gets its own rate limit (600 requests a minute instead of 120 per address), so its users do not block each other.
- The verified domain goes into the signed booking record (`consent.agentIdentity`, `consent.agentDomain`): in a dispute it is clear which platform sent the request.
- A broken signature is not an error: the request is served as an anonymous one, and the `x-innli-agent-identity` response header says why (`expired`, `bad_signature`, `replayed_nonce`, …).
- Owners can choose *Identified agents only* in the dashboard: anonymous agents can still search and quote, but requests need a key or a signature (`AGENT_IDENTITY_REQUIRED`).
- INNLI publishes its own keys at the same well-known path and signs its status callbacks with RFC 9421 too (`Content-Digest`, `Signature-Input`, `Signature`), so receivers can verify them with a standard library.

### 2. Speculative holds: the cheapest way to hurt a small property
An agent that "requests" every room keeps real guests out for as long as the hold lasts. Before 2.1, all anonymous agents also shared one action limit, so one noisy caller blocked the rest.

**INNLI 2.1:**
- Open requests are limited per holder and per property: 2 for an anonymous address, 25 for an identified agent, 3 per guest e-mail address. The error is `LIMIT_REACHED`, with `check_status` and `cancel_request` as next tools.
- An anonymous agent cannot hold more than half of a property's rooms at once.
- Anonymous agents are counted per address, not together.
- The dashboard shows per agent how many quotes and requests became bookings, and how many expired or were cancelled (`GET /api/owner/agents`).
- Addresses are stored only as a hash.

### 3. No booking protocol a property can serve itself
Agent platforms are converging on session-based checkout. UCP has a draft lodging capability with the objects a stay needs.

**INNLI 2.1** adds a UCP lodging adapter on every installation:
- Profile at `/.well-known/ucp`; REST endpoint `/ucp/v1`.
- `POST /booking-sessions`, `GET` and `PUT /booking-sessions/{id}`, `POST …/complete`, `POST …/cancel`.
- A session is one or more INNLI quotes with a 15-minute hold (`expires_at`). Identical rooms and up to three room types fit in one session.
- `totals[]` in minor units, adding up exactly to the one `total`; tourist tax and fees as their own lines.
- `policies[]` with `refundability` (`refundable`, `partially_refundable`, `non_refundable`). When the host only wrote a text policy, INNLI does not guess: it sends the text as a disclosure instead.
- `payment.terms[].schedules[]` say what is paid to the property and when (deposit, balance at the property). There are no payment handlers; platforms complete with `payment: {}`.
- Status follows the booking: `incomplete` → `ready_for_complete` → `completed` with instant booking, or `complete_in_progress` while the host decides. A property with its own booking system returns `requires_escalation` with a `continue_url`.
- Completing a session sends the same request as `request_booking`: same consent hash, hold limits and signed record.

The capability is a draft and will change. Set `INNLI_UCP_VERSION` to the version your platform expects.

### 4. Retries that book twice
A timeout does not tell an agent whether the booking went through.

**INNLI 2.1** accepts an `Idempotency-Key` header on REST tool calls and UCP operations:
- same key and same body: the first answer, with `Idempotent-Replayed: true`;
- same key and another body: `409`;
- answers are kept for 24 hours. Server errors and rate limits are not stored, so they can be retried.

### 5. Cancellation terms an agent has to parse
**INNLI 2.1** adds `cancellation` to every quote: `refundability`, `freeUntil`, and the cost of cancelling today. `unknown` when the host has no structured rules.

## What 2.1 deliberately does not do
- **Card payments by agents (ACP payment tokens, AP2 mandates).** They need a payment provider or a credential provider. INNLI moves no money: the guest pays the property. The session and the signed record are shaped so that a payment handler can be added later.
- **UCP over MCP, and signed UCP responses.** REST only for now.
- **Identity through the INNLI guide.** The guide relays requests; a signature is checked by the installation the agent calls directly.
- **The newest MCP revision.** INNLI follows the official SDK.

## Sources
Specifications read in their public repositories (November 2026): Universal-Commerce-Protocol/ucp (lodging booking, cancellation policy, signatures), agentic-commerce-protocol/agentic-commerce-protocol, google-agentic-commerce/AP2, cloudflare/web-bot-auth, visa/trusted-agent-protocol, modelcontextprotocol/modelcontextprotocol. Projects: openbnb-org/mcp-server-airbnb, STAYKER-COM/1Stay-mcp, HemmaBo-se/hemmabo-mcp-server. RFC 9421 (HTTP Message Signatures), RFC 9530 (Digest Fields), RFC 7638 (JWK Thumbprint).
