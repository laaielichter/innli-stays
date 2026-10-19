# Draft proposal for NLnet (submit when a call is open)

NLnet paused new submissions in June 2026 and announced new programmes for after the summer. Check https://nlnet.nl/propose/ for the open call and fit these answers to its form. Personal details go in the form only, not in this public repo.

## Proposal name

INNLI: an open agent gateway for independent accommodations

## Website / wiki

The public GitHub repository `innli-stays`.

## Abstract

AI agents are starting to search and book travel for people. Small independent accommodations risk becoming invisible to them, or reachable only through large platforms that own the data and the customer relationship and charge 15–22% commission.

INNLI is AGPL-3.0 software (agent kit MIT) that an accommodation hosts itself. It combines:
- an accommodation passport whose facts the owner confirms (confirmed, unconfirmed or unknown, never guessed);
- one open connection for any agent (MCP and REST/OpenAPI) to search, quote and, with the guest's explicit consent, request a booking;
- a small federated guide that lets agents reach all self-hosted installations through one address, while every installation answers live and keeps its own data.

Version 2.0 addresses ten problems we found between agents and accommodations:
- a lean tool profile (49% less context per turn) and brief answers (~70% smaller);
- a guard against indirect prompt injection in owner- and guest-written text (30/30 attacks caught and 0/40 benign sentences cut on our first labelled set);
- consent bound to a hash of the terms;
- website verification and an Ed25519-signed passport against fake listings;
- typed errors and next actions;
- discovery documents (an A2A-style agent card, an MCP server card, `llms.txt`);
- "stay wishes", where an agent leaves an anonymous request and hosts answer with offers, connecting supply and demand without a platform in between.

This project would harden INNLI and prove it in practice:
- a pilot with 10–20 accommodations;
- an open, multilingual prompt-injection benchmark for hospitality text (500+ cases);
- interoperability tests with several agent platforms;
- a short specification of the passport, consent hash and stay-wish exchange, so other software can implement them.

## Previous involvement

The author built INNLI from version 0.1 to 2.0: the passport, connectors (iCal, live API, Beds24), the stay page, the WordPress plugin, the guide and the agent tools. There are 158 automated tests, with documentation in Dutch and English.

## Requested amount

€ 30,000 (example; adjust to the programme's limits)

## Budget use

| Task | Amount |
|---|---:|
| 1. Specification of the passport, consent hash and stay-wish exchange (open document, test vectors) | € 6,000 |
| 2. Prompt-injection benchmark for hospitality text (500+ cases, 4 languages), guard improvements, comparison with model-based detection | € 7,000 |
| 3. Pilot with 10–20 accommodations: installation help, measurements, fixes | € 8,000 |
| 4. Interoperability with three or more agent platforms (MCP clients, OpenAPI actions) and the MCP registry | € 4,000 |
| 5. Security review of the guide and the signing, and privacy review (GDPR) | € 3,000 |
| 6. Documentation, translations, final report | € 2,000 |

Rate: € 60/hour.

## Comparison with existing efforts

- **Online travel agencies and channel managers** connect hotels to their own platforms. They own the data and charge per booking.
- **Hotel distribution APIs** target large chains and are not open.
- **Generic MCP servers** for booking platforms wrap one company's inventory.

INNLI is self-hosted, open, and built for the smallest providers. Its federated guide holds no prices, calendars or guest data. Its honesty model (confirmed, unconfirmed, unknown) and its consent hash are, as far as we know, not offered by any existing system.

## Technical challenges

- **Text guard:** rule-based guards are explainable but brittle, while model-based ones are costly and less predictable. The benchmark will show where each fails.
- **Federation:** keeping the guide abuse-resistant (proof of control, limits) without accounts or licence fees.
- **Trust:** signing and verifying passports in a way agents actually check.
- **Small hardware:** keeping everything fast and robust on a Raspberry Pi.

## Ecosystem

- **Who uses it:** independent B&Bs, guesthouses and small hotels; developers of travel agents; booking-system vendors who want an open agent connection.
- **How to reach them:** the WordPress plugin, the agent kit (Claude plugin, MCP registry entry), local tourism organisations and hospitality associations.
- **What we publish:** all results, datasets and the specification, under open licences.
