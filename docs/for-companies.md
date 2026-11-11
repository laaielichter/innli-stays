# For companies: licensing INNLI or taking it over

INNLI was built by one maker. This page is for a company that wants to build on it, or take over the whole project: a PMS or channel-manager vendor, a booking-engine or website builder for accommodations, an agent platform, or a tourism organisation. It says what exists, what is proven, and what is not there yet.

To start a conversation, see [Getting in touch](#getting-in-touch).

## What INNLI is

Software that an accommodation runs itself, so that AI agents can find it, understand it and book it without an intermediary:

- an **accommodation passport** of facts the owner confirmed, each with a status;
- an **agent connection** over MCP, REST (OpenAPI 3.1), ACP checkout sessions and UCP lodging booking sessions (draft);
- **card guarantees** from agent platforms: authorised at checkout, captured only when the host confirms, on the property's own payment account;
- **pricing, availability and booking**: itemised totals, holds, booking requests or instant booking, changes, cancellations, signed records;
- a **dashboard** for the owner (English and Dutch), a public **stay page** in four languages, and a **WordPress plugin**;
- the **INNLI guide**: one address through which agents reach every listed installation.

What it does in detail: [agent-features.md](agent-features.md), [agent-integration.md](agent-integration.md), [hotels.md](hotels.md).

## What a buyer would get

| Asset | What it is |
|---|---|
| Source code | This repository: about 16,000 lines of TypeScript for the server, 3,900 lines of tests, the dashboard, and the WordPress plugin |
| Copyright | Held by the maker. See [Ownership of the code](#ownership-of-the-code) |
| The name | "INNLI", the wordmark and the house style ([TRADEMARK.md](../TRADEMARK.md), [marketing/STYLE.md](../marketing/STYLE.md)). Not registered as a trade mark |
| Package names | `innli-stays` on npm and `io.github.laaielichter/innli` in the MCP registry |
| The GitHub repository | With its history, releases, issues and the website published from `site/` |
| Research | Research questions, datasets and measurements in [research/](../research/README.md), and two write-ups with sources: [agents-2.0.md](agents-2.0.md), [agents-2.1.md](agents-2.1.md) |
| Licence tooling | Offline-verifiable Ed25519 licence keys for a guide that only lists licensed installations (`tools/license.ts`) |

## Why it is useful to own

- **It covers the whole route**, from being found to a signed booking record, where other projects stop at search or send the guest to a checkout page elsewhere.
- **One server speaks every agent ecosystem**: MCP (full and a small core profile), OpenAPI, ACP (OpenAI and Stripe), UCP lodging over REST and MCP (Google), Web Bot Auth (RFC 9421), OAuth 2.1, an agent card and `llms.txt`.
- **It is built around trust**: facts with a status, complete prices or an explicit warning, consent tied to a hash of the terms, limits against speculative holds, and a guard against hidden instructions in text.
- **It needs no infrastructure**: one Node.js process and files on disk. It runs on a Raspberry Pi. Storage sits behind a narrow interface, measured with 300 properties and 200,000 events ([performance.md](performance.md)).
- **It connects to what a property has**: a live booking API ([connector-contract.md](connector-contract.md)), Beds24, iCal calendars, or its own room calendar.

## What is proven

Everything here can be reproduced from the repository.

| Claim | How to check |
|---|---|
| 188 automated tests pass, including end-to-end flows over MCP, REST, ACP and UCP | `npm test` |
| Types are strict and clean | `npm run typecheck` |
| The npm package installs and starts | `npm run smoke:npm` |
| A running installation behaves as agents expect | `npx innli-conformance <address>`: 14 read-only checks |
| Token cost per turn and per answer | `npm run measure` |
| The text guard catches the labelled injection cases | `npm run research:injection` |
| Performance figures | `npm run bench` |
| Continuous integration on every pull request | `.github/workflows/ci.yml` |

The 2.1 changes went through a separate security review pass by an AI reviewer that had not written the code. Its findings and their fixes are in the [changelog](../CHANGELOG.md) under *Hardened after an independent review*; the security model is in [SECURITY.md](../SECURITY.md). There has been no audit by an outside security firm.

## What is not there

- **No customers and no revenue.** INNLI is not in commercial use. There are no usage figures to show.
- **Not tested against a live agent platform.** The ACP and UCP adapters are built against the specification texts. The UCP lodging capability is a draft, and ACP has no lodging objects, so INNLI encodes a stay in the item id.
- **Card payments are not proven against a real provider.** The ACP adapter and the authorise, capture and release cycle are tested end to end against a stand-in for Stripe. The Stripe handler itself has not been run against Stripe, and 3D Secure is not supported.
- **No hosted service.** Every installation is self-hosted. There is no multi-tenant control plane, billing or customer support.
- **File storage only.** There is no database backend yet, though the store has a narrow interface for one.
- **One maintainer.** There is no team that comes with the project.
- **The name is not registered** as a trade mark.

## Ownership of the code

- **Authors.** The commit history shows the maker (under more than one name and address), an AI coding assistant working at the maker's direction, and automated dependency updates. There are no contributions from other people so far.
- **AI assistance.** Large parts of the code were written with an AI coding assistant, as the commit trailers show. A buyer should take its own advice on what that means for copyright in its jurisdiction.
- **Future contributions** fall under the [contributor agreement](../CLA.md), which lets the maintainer license them under other terms as well.
- **Dependencies.** 95 run-time packages, all under permissive licences (MIT, ISC, BSD); none is copyleft. The full list is in [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md).
- **No secrets in the repository.** Signing keys are created per installation and stay in its data folder.

## What the licence means for a new owner

- Everything published so far is under the **AGPL-3.0** (the agent kit under MIT, the WordPress plugin under GPL-2.0-or-later). That cannot be withdrawn: anyone may keep using and forking those versions.
- The copyright holder decides how **future versions** are licensed, and can sell **commercial licences** to companies that do not want the AGPL's obligations.
- The AGPL means a competitor who offers a modified INNLI as a service must publish its changes.
- The name is separate from the code: a fork may not call itself INNLI ([TRADEMARK.md](../TRADEMARK.md)).

## How this works

- **A licence** has a fixed price and a short agreement: [COMMERCIAL.md](../COMMERCIAL.md).
- **A takeover** goes by written offer. Say what you want to take over and what you offer. The maker answers in writing, within a week.
- Everything is arranged in writing. No calls or meetings are needed, and none are offered.
- The maker does not join the buyer as an employee and does not offer support after a handover, beyond answering written questions about the code for an agreed, limited time.

## Getting in touch

Use the profile of the owner of this GitHub repository, or open an issue with the *Commercial* template. That issue is public: say only who you are and how to reach you.
