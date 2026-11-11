# INNLI as an open research project

Nederlands: [README.nl.md](README.nl.md).

**Status (October 2026):** INNLI is an open research project under the AGPL-3.0 (with a commercial licence for those who need one), funded from the maker's own means. There is no external funding. Public funds are an option for later; so is earning money, and only in ways that do not harm the open character (see [funding/overzicht.md](funding/overzicht.md) (in Dutch)).

## The question

AI agents are going to search and book on behalf of travellers. Large platforms are ready for that. Small, independent accommodations are not: they become invisible to agents, or reachable only through platforms that charge 15–22% commission.

**Main question:** can an open, self-hosted connection make sure that agents find and book small accommodations honestly, safely and efficiently, without an intermediary that owns the data or the customer relationship?

## Sub-questions, measurement method and first results

Everything is reproducible with the scripts in this repo. Guest data never ends up in a research dataset.

| # | Question | How we measure | First result | Next step |
|---|---|---|---|---|
| 1 | **Efficiency:** how much context and time does an agent connection for stays cost, and how much can be cut without losing information? | `npm run measure`: tokens for the tool definitions per turn and per answer, full versus compact | Core profile: 49% less context per turn. Compact answers: ~70% smaller. The same facts and statuses. | Measure with real agent conversations (number of steps, costs, errors) on three agent platforms |
| 2 | **Safety:** can a simple, explainable filter stop indirect prompt injection in texts by owners and guests, without cutting ordinary hospitable text? | `npm run research:injection` on [data/injection-cases.json](data/injection-cases.json): 70 labelled sentences in four languages | 30/30 attacks caught, 0/40 ordinary sentences cut. The evaluation found and fixed a bug with markdown links. | Extend the set to 500+ sentences: real listing texts, rephrasings and attacks from outside. Compare with a language model as detector. |
| 3 | **Consent:** does a hash over the terms prevent an agent from booking on terms the guest did not see? | Automated tests in which price, cancellation or dates change between quote and booking | Every change stops the request (`TERMS_CHANGED`) | User research: do guests understand the summary, and does the extra step cost bookings? |
| 4 | **Supply and demand:** do anonymous stay wishes lead to offers and bookings at small accommodations? | Pilot with 5–10 accommodations: wish → offer → request → booking, and the time until an offer | Works end-to-end in tests, also through the guide | Run the pilot and publish the funnel |
| 5 | **Trust:** do verified signals (website proof, signed passport) change which stays agents choose? | Experiment: the same search query to several agents/models, with and without the trust block | Not measured yet | Set up an experiment with 3+ models |
| 6 | **Discoverability:** which documents (agent card, MCP server card, `llms.txt`) do agents and crawlers actually fetch? | Access log per user agent on the public guide | Not measured yet | Add a count to the guide, without storing IP addresses |

## How we work

- **Open:** code (AGPL-3.0, agent-kit MIT), datasets and scripts are in this repo. We publish results here, also when they are disappointing.
- **Reproducible:** every number above comes from a script that anyone can run.
- **Privacy:** research uses only aggregated counts or self-made sample texts, never guest data.
- **Honest about limitations:**
  - the injection set is small and compiled by ourselves;
  - the Beds24 connection has not been tested with a real account yet;
  - the pilot with accommodations has yet to start.

## Background

- [../docs/agents-2.0.md](../docs/agents-2.0.md): the ten biggest problems between agents and accommodations, with sources.
- [../docs/research-booking-problems.md](../docs/research-booking-problems.md): earlier research into booking through agents.
- [funding/](funding/) (partly in Dutch): funds, draft applications and the plan to earn money later.

## Citing

See [../CITATION.cff](../CITATION.cff).
