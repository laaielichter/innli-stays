# Architecture

How INNLI is put together, for a company that wants to build on it, run it at scale or take it over. It describes the code as it is, including what would have to change.

## One sentence

One Node.js process per installation: business rules in the middle, several protocols around it as thin adapters, and files on disk behind a narrow storage interface.

## The parts

```
                 agents                            owners and guests
   MCP   REST/OpenAPI   UCP   ACP   guide      dashboard   stay page   e-mail
    │         │          │     │      │            │           │          │
 ┌──┴─────────┴──────────┴─────┴──────┴────────────┴───────────┴──────────┴──┐
 │ Ways in:  src/mcp  src/http  src/ucp  src/acp  src/directory  src/web      │
 ├────────────────────────────────────────────────────────────────────────────┤
 │ Services: catalog (search, details, quotes) · requests (booking requests,  │
 │           questions, waiting list, stay wishes) · agent (identity, consent,│
 │           reply guard, text guard) · booking · analytics · readiness       │
 ├────────────────────────────────────────────────────────────────────────────┤
 │ Business rules: src/domain  (facts, pricing, matching, cancellation,       │
 │                 dates, rental, jurisdictions)                              │
 ├────────────────────────────────────────────────────────────────────────────┤
 │ Out: store (files) · connectors (booking systems, iCal) · payments ·       │
 │      mail · security (signing keys)                                        │
 └────────────────────────────────────────────────────────────────────────────┘
```

| Layer | Folder | What it knows |
|---|---|---|
| Business rules | `src/domain` | What a fact is, how a price is built, who may rent a camper. No HTTP, no files, no protocol |
| Services | `src/catalog.ts`, `src/requests`, `src/agent`, `src/booking`, `src/analytics`, `src/readiness` | What an owner or an agent can do, in terms of the business rules |
| Ways in | `src/mcp`, `src/http`, `src/ucp`, `src/acp`, `src/web`, `src/directory` | One protocol each. An adapter translates and calls a service; it holds no rules of its own |
| Out | `src/store.ts`, `src/connectors`, `src/payments`, `src/security` | Files, other systems, keys |
| Start-up | `src/main.ts`, `src/config.ts`, `src/cli.ts` | Reads the environment and wires the parts together |

**The map is a test.** `test/architecture.test.ts` lists which module may use which. A new dependency between modules fails the test, so it is a decision and not an accident. The business rules are checked separately: they may not import HTTP, MCP or the file system.

## Principles the code keeps

1. **One implementation, many protocols.** `toolHandlers` in `src/mcp/server.ts` is the single list of what an agent can do. MCP, REST and the guide call it directly; UCP and ACP translate their own shapes into the same calls. A rule added once holds for every protocol.
2. **A fact has a status.** Confirmed, not confirmed or unknown. Automated sources can only suggest; only the owner confirms. This runs from the passport to the quote to the reply guard.
3. **The guest agrees to exact terms.** The consent hash covers price, dates, party, conditions and, for campers, the rental terms. A change after approval refuses the request instead of sending it.
4. **Nothing is booked by accident.** Holds are limited per agent and per guest; retried calls are recognised by an idempotency key; a booking only exists when the record says so.
5. **Text from people is data.** Host and guest text is cleaned of instruction-like content before an agent sees it.
6. **The installation is the owner's.** No account with the maker, no call home, no shared database. An installation may register with a guide if the owner chooses to.

## Data

- **Storage** is `Store` in `src/store.ts`: properties in one JSON snapshot, everything that grows (quotes, requests, questions, events, waiting list, wishes, sessions) in append-only JSON-lines logs with an in-memory index. Writes cost one line; logs are compacted when they grow, and rewritten when personal data is removed.
- **The interface is narrow**: services call methods such as `getProperty`, `saveRequest`, `requestsFor`. No service reads a file.
- **Personal data** and how long it is kept: [PRIVACY.md](../PRIVACY.md).
- **Backups**: a daily copy to a second folder, and a download per property.
- **Keys**: owner, staff and agent keys are stored as hashes. Each installation makes its own Ed25519 key for signing booking records.

## Trust boundaries

| Boundary | What crosses it | How it is guarded |
|---|---|---|
| Agent → installation | Tool calls | Optional agent keys, signed requests (Web Bot Auth), rate limits, hold limits, input validation with zod |
| Installation → agent | Facts, prices, host text | Status on every fact, text guard, reply guard |
| Owner → installation | Dashboard API | Owner and staff keys with roles; set-up code on first use |
| Installation → booking system | Availability, prices | Outbound requests through a guarded fetch (no private addresses), time budgets |
| Installation → payment provider | Authorise, capture, release | A token from the agent platform; card numbers never reach INNLI |
| Guide → installation | Relayed tool calls | Signed by the guide, accepted only from the configured guide address |

More in [SECURITY.md](../SECURITY.md).

## Running it

- **One process, one data folder.** Health at `/health`; a conformance check for a running installation (`npx innli-conformance <address>`).
- **Configuration** through environment variables only (`src/config.ts`).
- **Releases**: one workflow builds the zips, the Docker image (x86 and ARM) and the npm package from one version number.
- **Measured**: 300 properties and 200,000 events on one process ([performance.md](performance.md)).

## What a larger operator would change

The code is built for one installation per business. These are the honest gaps for running it as a platform, with where the change would go.

| Gap | Where the change goes | Size |
|---|---|---|
| A database instead of files | A second implementation of the methods of `Store`. Services do not change | Medium: about 60 methods |
| Several processes | Rate limits, hold counters and the idempotency cache are in memory (`src/http`, `src/requests/agentActions.ts`). They need a shared store such as Redis | Medium |
| Many businesses in one installation | Already possible: a store holds many properties, each with its own keys. Missing: sign-up, billing, an operator console | Large |
| Observability | Logs go to the console. No metrics endpoint, no tracing | Small |
| `src/http/app.ts` is one file of about 1,200 lines | Split per audience (owner, agent, admin, public). Routes are already grouped that way inside the file | Small, mechanical |
| Some modules reach back to `src/http` for the guarded fetch and rate limiter | Move `safeFetch` to its own module. The architecture test names every such edge | Small |
| Dashboard is plain JavaScript without a build step | Fine at this size; a larger team may want components and types | Optional |

## What is deliberately not there

No accounts with the maker, no tracking, no ranking that can be bought, no language model inside the server. Each is a choice, described in the README.
