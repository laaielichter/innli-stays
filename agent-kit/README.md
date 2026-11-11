# INNLI agent kit

Everything an agent platform or developer needs to connect an agent to INNLI. The kit is MIT-licensed ([LICENSE](LICENSE)), unlike the AGPL core: copy it, change it and ship it with your agent.

| What | Where |
|---|---|
| MCP endpoint (all tools) | `https://<installation or guide>/mcp` |
| MCP endpoint, core profile (8 tools, brief answers) | `https://<…>/mcp?profile=core` |
| REST + OpenAPI 3.1 (e.g. GPT Actions) | `https://<installation>/api/agent/v1/openapi.json` |
| Agent card (A2A-style, for discovery) | `/.well-known/agent-card.json` |
| MCP server card | `/.well-known/mcp.json` |
| Plain-text overview for LLMs | `/llms.txt` |
| Signing key (records, callbacks, passports) | `/.well-known/innli.json` |
| OAuth 2.1 metadata | `/.well-known/oauth-protected-resource` |
| ACP checkout sessions (item = a quoteId or a stay id) | `/.well-known/acp.json`, `/acp/checkout_sessions` |
| UCP profile and lodging booking sessions (draft), REST and MCP | `/.well-known/ucp`, `/ucp/v1/booking-sessions`, `/ucp/mcp` |
| Key directory (RFC 9421; INNLI also verifies yours) | `/.well-known/http-message-signatures-directory` |

## Claude plugin

`claude-plugin/` is a ready-made plugin: an MCP connection on the core profile plus a `find-stay` skill that teaches the honest flow (confirmed facts, consent summary, stay wishes).

```bash
export INNLI_URL=https://your-innli.example   # or the INNLI guide
claude --plugin-dir ./agent-kit/claude-plugin
```

## MCP registry

`server.json` describes INNLI for the MCP registry as `io.github.laaielichter/innli`: the npm package `innli-stays` (stdio, `innli-mcp`) and a remote Streamable HTTP endpoint on any installation.

## Examples

Two small programs without dependencies, to copy into your own agent (`examples/`):

- **`web-bot-auth.mjs`**: sign your requests so a stay knows who is calling. `node agent-kit/examples/web-bot-auth.mjs new-key` makes a key and prints the JWKS to publish; `createSigner({ origin, privateKeyPem }).sign(url)` returns the headers for one request.
- **`book-a-stay.mjs`**: the whole honest flow over REST: search, facts with their status, an itemised quote, the consent summary, a safe retry and an exact status. It stops before booking unless you pass `--book`.

```bash
npm run demo:intl                                   # sample stays at http://localhost:3000
node agent-kit/examples/book-a-stay.mjs "Tuscany"   # add --book to send the request
```

## What agents get in 2.1

- **Identity without an account.** Sign your requests with Web Bot Auth (RFC 9421, Ed25519, `tag="web-bot-auth"`, keys at `<your origin>/.well-known/http-message-signatures-directory`). A verified platform gets its own rate limit (600 a minute), may hold more open requests, and is named in the signed booking record. The `x-innli-agent-identity` response header says how you were recognised, or why a signature failed.
- **Hold limits.** Open requests hold rooms, so they are limited: 2 per property for an anonymous address, 25 for an identified agent, 3 per guest e-mail. On `LIMIT_REACHED`, wait for the host or withdraw a request with `cancel_request`.
- **`AGENT_IDENTITY_REQUIRED`.** Some hosts only take requests from identified agents. Without a key or signature, give the guest the link from `prepare_booking`.
- **Idempotency.** Send an `Idempotency-Key` header on REST and UCP calls. A retry gets the first answer with `Idempotent-Replayed: true`.
- **UCP lodging booking sessions (draft).** `POST /ucp/v1/booking-sessions` with `property`, `stays[]` (`accommodation_type.id`, `rate_plan.id`, `occupancy`, `stay_dates`), then `PUT` the booker or guests, then `POST …/complete` with `payment: {}`. `completed` means booked; `complete_in_progress` means the host still decides.
- **`cancellation`** on every quote: `refundability`, `freeUntil`, and the cost of cancelling today.
- **Signed callbacks, the standard way.** Status callbacks carry `Content-Digest`, `Signature-Input` and `Signature` (RFC 9421) next to the signature in the body.

- **Through the INNLI guide too.** The guide verifies your signature and passes it on, signed, to each installation: you stay verified and your limits are your own.
- **Conformance check.** `npx innli-conformance https://stay.example` runs 14 read-only checks against any installation.

Details: [docs/agents-2.1.md](../docs/agents-2.1.md).

## What agents get in 2.0

- **Core profile and brief answers.** `?profile=core` loads 8 tool definitions instead of 19. `detail: "brief"` returns the same facts and statuses in a fraction of the tokens. Run `npm run measure` for the numbers.
- **`nextActions`.** Every result names the next calls, with the arguments already filled in, and says what still has to come from the guest.
- **`freshness`.** How long a result stays reliable, and how old the underlying availability data is.
- **Typed errors.** `code`, `retryable`, `retryAfterSeconds`, `hint` and `nextTools`, both in MCP (`structuredContent.error`) and in REST, with RateLimit headers.
- **Consent in one step.** Each quote has `consent.summary` (one paragraph for the guest) and `consent.hash`. Pass the hash as `consentHash`. If the terms changed in the meantime, nothing is sent.
- **Trust.** Every result has a trust block: website ownership proven by the owner, verified reviews, flags and payment safety. Every passport is signed with Ed25519.
- **Injection guard.** Text written by hosts and guests is cleaned of instruction-like sentences and hidden characters before you see it. `contentSafety` says what was removed.
- **Stay wishes.** `post_stay_wish` posts an anonymous wish. Hosts whose stay fits can answer with their own offer. `get_wish_offers` collects the offers.
- **Time budget.** `search_stays({ timeBudgetMs })` answers on time. Slow booking systems are listed under `pending`.
