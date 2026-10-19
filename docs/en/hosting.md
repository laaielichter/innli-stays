# Running INNLI: locally or online, as cheaply as possible

## The most important point first

INNLI is free and open source. The B&B runs the software itself. Next to that runs one small **INNLI guide**: the single address agents use to find all self-hosted B&Bs.

AI agents must be able to reach the B&B's installation over the internet **24 hours a day**. If that computer is switched off, the accommodation cannot be found at that moment. Running it locally is perfectly fine, as long as the computer stays on and can be reached through a tunnel.

## Options and costs

This applies both to a B&B's installation and to your guide. Prices checked in October 2026; Hetzner prices exclude VAT.

| Option | Cost per month | Advantages | Disadvantages |
|---|---|---|---|
| **A. Own PC or Raspberry Pi + Cloudflare Tunnel** | €0 for hosting; electricity for a Pi about €1 per month; domain name about €10 per year | No server costs, data stays with the owner, no ports to open in the router | Must always be on; no home internet or power = cannot be found |
| **B. Oracle Cloud Always Free + Cloudflare Tunnel** | €0 + domain name | A real server in a data centre, free | Credit card needed to sign up; free capacity is not always available and can change (in June 2026 Oracle halved the free ARM capacity to 2 cores / 12 GB, which is still plenty) |
| **C. Hetzner CX23 (2 vCPU, 4 GB)** | €5.49 + €0.50 for IPv4 | Reliable, in the EU, simple | Costs money from day one (Hetzner raised its prices in June 2026) |

You need a fixed address: agents and guests must see an address they can trust (e.g. `innli.your-bnb.com`). A *Cloudflare named tunnel* needs a domain whose DNS is at Cloudflare; a B&B with its own website can use a subdomain of it. The free *Quick Tunnel* (`*.trycloudflare.com`) works without a domain, but the address changes every time it restarts: only suitable for testing.

### Advice if you have no starting capital

- **Your guide:** on option A or B. It is small (a list of installations, no guest data), so it costs €0 plus your domain name. Only move to option C once there are many installations.
- **The B&B:** a Raspberry Pi or old PC that is always on (option A) is the cheapest for most B&Bs. Anyone who does not want that can choose option B or C at their own expense. You could offer paid installation help.

## Installation

### Without Docker (Windows, Mac, Linux, Raspberry Pi)

Requires [Node.js](https://nodejs.org) 22.18 or newer.

```bash
npm install --omit=dev
npm start            # shows an installation code; open http://localhost:3000/dashboard/ and follow the wizard
```

Set `INNLI_GIDS_URL` to the address of the guide, and the installation registers itself automatically (at start-up and every 12 hours). No licence key is needed.

### With Docker (recommended on a server or Raspberry Pi)

```bash
cp .env.example .env                                  # fill in INNLI_PUBLIC_URL
docker compose up -d
docker compose logs innli                             # installation code for the wizard
```

The image works on ordinary PCs and on ARM (Raspberry Pi 4/5, Oracle Ampere). Data is stored in the Docker volume `innli-data`.

### Making it reachable with Cloudflare Tunnel (free)

1. Move your domain to Cloudflare (free plan).
2. Cloudflare Zero Trust → *Networks → Tunnels* → *Create a tunnel* (type Cloudflared).
3. Add a *public hostname*, e.g. `innli.yourdomain.com`, with service `http://innli:3000` (Docker) or `http://localhost:3000` (without Docker).
4. Put the token in `.env` as `TUNNEL_TOKEN` and set `INNLI_PUBLIC_URL=https://innli.yourdomain.com`.
5. `docker compose --profile tunnel up -d`

Without Docker: install `cloudflared` and run `cloudflared tunnel run --token <token>`.

To test quickly without a domain: `cloudflared tunnel --url http://localhost:3000` gives you a temporary `trycloudflare.com` address.

### Backup

Everything is in the `data/` folder (or in the Docker volume):

- `innli.json`: settings, accommodations, agent keys and the signing key;
- `innli.*.jsonl`: requests, questions, events, quotes, waiting list and search statistics.

Always copy **the whole folder**, not just `innli.json`. It is safest to do this while INNLI is stopped, or just after the hour. Files are only ever added to, so a copy made while it is running misses at most the last few seconds. For example, with a daily task:

```bash
tar czf backup-$(date +%F).tgz data/
# Docker:
docker compose cp innli:/app/data ./backup-$(date +%F)
```

To restore: stop INNLI, put the folder back, start INNLI.

**Automatic:** set `INNLI_BACKUP_DIR=/path/to/backups`, for example a USB disk or a folder synced by Dropbox, OneDrive or iCloud. INNLI then copies the data folder, including uploaded photos, to `innli-YYYY-MM-DD` every day, and keeps `INNLI_BACKUP_KEEP` of them (default 14). The folder must be outside the data folder. With Docker, mount it as an extra volume. The seller's secret licence key is never copied.

## Connecting calendars and booking systems

In the dashboard under **Booking & details**:

| The B&B's situation | Choose | What agents offer the guest |
|---|---|---|
| Keeps track of open rooms in a notebook, in Excel or in their head | *I keep track of open rooms in INNLI myself*: close nights per room under **Rooms → Room calendar** | Availability request |
| Also lets rooms through Airbnb or Booking.com, or uses Google Calendar | *My calendars*: paste the iCal export links for each room, one per line | Availability request |
| Has a booking system with an API | *Booking system with a live connection* (see the [connector contract](../connector-contract.md) (Dutch)) | Direct booking link with a live price |

Nights you close in the room calendar always apply, also on top of connected calendars. With the export link under the room calendar, Airbnb or Booking.com can pick up those closed nights too.

Does the booking system run on the same network as INNLI (e.g. on the same PC)? Then set `INNLI_ALLOW_PRIVATE_FETCH=1`. By default INNLI refuses requests to internal network addresses, for security.

## Sources

- [Hetzner price increase June 2026 (CX23 €5.49)](https://privatedevops.com/news/hetzner-june-2026-cloud-price-increase-what-to-do)
- [Oracle Cloud Free Tier in 2026](https://macmyths.com/oracle-cloud-free-tier-whats-actually-free-in-2026/)
- [Cloudflare Tunnel: named tunnels need a domain, Quick Tunnels do not](https://flaviocopes.com/cloudflare-tunnel/)
