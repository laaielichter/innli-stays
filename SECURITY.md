# Security

## Reporting a vulnerability

Please report it privately through [GitHub security advisories](https://github.com/laaielichter/innli-stays/security/advisories/new). Do not open a public issue. Say what you found, how to reproduce it and which version you used. You get an answer as soon as the maintainer has read it; a fix and an advisory follow together.

Only the latest release gets security fixes.

## What INNLI protects, and how

INNLI runs at the accommodation itself and holds guest names, e-mail addresses and bookings. The main risks, and what the software does about them:

| Risk | What INNLI does |
|---|---|
| An agent pretends to be a known platform | Web Bot Auth: requests signed with HTTP Message Signatures (RFC 9421) are checked against the platform's own key directory. A signature only counts for this installation's public host, a nonce is accepted once, and a signed `Content-Digest` is compared with the body. |
| A script holds every room without booking | Open requests and short holds are limited per caller and per guest. Hosts can accept requests from identified agents only. |
| Hidden instructions in text an agent reads | Text written by hosts and guests is cleaned of instruction-like sentences and invisible characters, and the agent is told what was removed. |
| A booking nobody agreed to | A request needs the guest's consent, and a hash over the exact terms. If the terms changed, nothing is sent. The result is a signed record. |
| A retry that books twice | `Idempotency-Key`, scoped to the caller and stored with the request. |
| The server is used to reach an internal network | Owner-supplied URLs and key directories are fetched through a filter that refuses private addresses, also after redirects. |
| Look-alike listings | Website verification, a trust block in every result and an Ed25519-signed passport. |
| Guest data kept too long | Personal data is removed after the retention period (`INNLI_BEWAARTERMIJN_DAGEN`, default 180 days). |

## Running it safely

- Serve it over HTTPS and set `INNLI_PUBLIC_URL` to the public address. Signatures are verified against that host.
- `INNLI_TRUST_PROXY` says how many reverse proxies or tunnels sit in front (default `1`). Reachable directly from the internet: set it to `0`, or a caller can pretend to be another address.
- Keep the data folder private. It holds the signing key, owner key hashes and guest data. Back it up with `INNLI_BACKUP_DIR`.
- Set `INNLI_ADMIN_KEY` only if you use the admin API, and keep it long and random.
- `INNLI_ALLOW_PRIVATE_FETCH=1` lets the server call addresses on your local network. Use it only when your booking system runs there.

## Checking an installation

`npx innli-conformance https://your-address` runs 13 read-only checks of what agents rely on, including whether signatures are verified. Nothing is booked.
