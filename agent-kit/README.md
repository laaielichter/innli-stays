# INNLI agent kit

Everything an agent platform or developer needs to connect an agent to INNLI.

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

## Claude plugin

`claude-plugin/` is a ready-made plugin: an MCP connection on the core profile plus a `find-stay` skill that teaches the honest flow (confirmed facts, consent summary, stay wishes).

```bash
export INNLI_URL=https://your-innli.example   # or the INNLI guide
claude --plugin-dir ./agent-kit/claude-plugin
```

## MCP registry

`server.json` describes INNLI for the MCP registry. Replace `OWNER/REPO` with the GitHub repository it is published from before you submit it.

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
