# The ten biggest problems between agents and accommodations (research, October 2026)

AI agents are starting to search and book on behalf of travellers. Whether a small accommodation is found then depends on what happens between the agent and that accommodation. For INNLI 2.0 we looked at what goes wrong most often in practice, on both sides:

- the **agent**: the tokens, time and trust it needs to do a good job;
- the **accommodation**: being found, and being able to offer itself.

Below, each problem is followed by what INNLI 2.0 does about it. Sources are listed at the end of the Dutch version: [../agents-2.0.md](../agents-2.0.md#bronnen).

1. **Too many tokens for tool definitions and answers.** An agent loads every tool definition on every turn, and long JSON answers slow it down.
   - The core profile (`/mcp?profile=core`) offers 8 tools instead of 19, saving about 49% of context per turn.
   - `detail: "brief"` returns the same facts in about 70% fewer tokens.
   - JSON is sent compact.
   - `npm run measure` shows the numbers.
2. **Hidden instructions in text written by owners and guests (indirect prompt injection).** Hidden characters and instruction-like sentences are removed before an agent sees the text.
   - `contentSafety` tells the agent what was removed.
   - The dashboard tells the owner which sentences to rewrite.
   - Ordinary hospitality language stays.
3. **Stale data.** Every answer carries `freshness`: how long it stays reliable, and how old the underlying calendar data is. `passport` says when the host last confirmed something and how many facts need a recheck.
4. **Agents cannot find the accommodation.**
   - Every installation and the INNLI guide serve `/.well-known/agent-card.json` (A2A shape), `/.well-known/mcp.json` and `/llms.txt`.
   - `agent-kit/` contains a `server.json` for the MCP registry and a Claude plugin with a `find-stay` skill.
5. **Supply and demand do not meet.** Search works in one direction only. INNLI adds stay wishes:
   - `post_stay_wish` posts an anonymous wish. Contact details are removed from the note.
   - Fitting stays answer at once.
   - Hosts whose stay fits see the wish in the dashboard tab *Wanted* and can make an offer, optionally with a one-time discount just for this guest.
   - `get_wish_offers` collects the offers, each with a fresh price.
   - The guide spreads one wish over every installation in the area.
6. **Fake listings and look-alike sites.**
   - Website verification by meta tag or file. The WordPress plugin adds the tag by itself.
   - A `trust` block in every result: verified domain, real reviews, flags and payment safety.
   - An Ed25519-signed passport that anyone can check against the original.
7. **Booking without real consent.** Every quote carries `consent.summary` and `consent.hash`.
   - The agent passes the hash as `consentHash`.
   - If the price, dates, party or cancellation terms changed in between, nothing is sent (`TERMS_CHANGED`).
   - The hash and summary go into the signed booking record.
8. **Blocking and rate limits.**
   - Every agent response carries IETF RateLimit headers.
   - A 429 comes with `Retry-After` and a structured `RATE_LIMITED` error.
   - Anonymous agents may search and quote, and OAuth 2.1 is available for platforms.
9. **Error messages an agent cannot act on.**
   - Errors carry `code`, `retryable`, `retryAfterSeconds`, `hint` and `nextTools`: in MCP under `structuredContent.error`, and in REST with a matching HTTP status.
   - The guide keeps the installation's code.
   - `search_stays({ timeBudgetMs })` answers on time and lists slow booking systems under `pending`.
10. **Too much back and forth.** Every answer carries `nextActions`: the next calls with their arguments already filled in.
    - `needs` lists what to ask the guest.
    - `requiresGuestApproval` says when the guest must say yes first.
