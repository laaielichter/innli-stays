# INNLI draaien: lokaal of online, zo goedkoop mogelijk

## Eerst het belangrijkste

INNLI wordt verkocht als **eenmalige koop**: de B&B draait de software zelf. De verkoper host alleen de kleine **INNLI-gids**, het ene adres waarmee agents alle zelf-gehoste B&B's vinden.

AI-agents moeten de installatie van de B&B **24 uur per dag** via internet kunnen bereiken. Staat die computer uit, dan is de accommodatie op dat moment onvindbaar. Lokaal draaien kan dus prima, zolang de computer aan blijft en via een tunnel bereikbaar is.

## Opties en kosten

Dit geldt zowel voor de installatie van een B&B als voor jouw gids. Prijzen gecontroleerd in oktober 2026; Hetzner-prijzen zijn exclusief btw.

| Optie | Kosten per maand | Voordelen | Nadelen |
|---|---|---|---|
| **A. Eigen pc of Raspberry Pi + Cloudflare Tunnel** | €0 aan hosting; stroom van een Pi ±€1 per maand; domeinnaam ±€10 per jaar | Geen serverkosten, data blijft bij de eigenaar, geen poorten openzetten in de router | Moet altijd aan staan; thuisinternet of stroom weg = onvindbaar |
| **B. Oracle Cloud Always Free + Cloudflare Tunnel** | €0 + domeinnaam | Echte server in een datacenter, gratis | Creditcard nodig voor aanmelding; gratis capaciteit is niet altijd beschikbaar en kan veranderen (in juni 2026 halveerde Oracle de gratis ARM-capaciteit naar 2 cores / 12 GB, nog steeds ruim genoeg) |
| **C. Hetzner CX23 (2 vCPU, 4 GB)** | €5,49 + €0,50 voor IPv4 | Betrouwbaar, in de EU, simpel | Kost geld vanaf dag één (Hetzner verhoogde de prijzen in juni 2026) |

Een vast adres is nodig: agents en gasten moeten een betrouwbaar adres zien (bijv. `innli.jouw-bnb.nl`). Een *Cloudflare named tunnel* vereist een domein waarvan de DNS bij Cloudflare staat; een B&B met een eigen website kan daar een subdomein van gebruiken. De gratis *Quick Tunnel* (`*.trycloudflare.com`) werkt zonder domein, maar het adres verandert bij iedere herstart: alleen geschikt om te testen.

### Advies zonder startkapitaal

- **Jouw gids:** op optie A of B. Hij is klein (een lijst installaties, geen gastgegevens) en kost dus €0 plus je domeinnaam. Pas naar optie C als er genoeg verkopen zijn.
- **De B&B:** een Raspberry Pi of oude pc die altijd aan staat (optie A) is voor de meeste B&B's het goedkoopst. Wie dat niet wil, neemt optie B of C op eigen rekening. Bied eventueel betaalde installatiehulp aan.

## Installatie

### Zonder Docker (Windows, Mac, Linux, Raspberry Pi)

Vereist [Node.js](https://nodejs.org) 22.18 of nieuwer.

```bash
npm install --omit=dev
npm start            # toont een installatiecode; open http://localhost:3000/dashboard/ en volg de wizard
```

Licentie activeren: in het dashboard (Overzicht → *Licentie & INNLI-gids*) of `npm run innli -- licentie <sleutel>`. Zet `INNLI_GIDS_URL` op het adres van de gids, dan meldt de installatie zich automatisch aan (bij start en elke 12 uur).

### Met Docker (aanbevolen op een server of Raspberry Pi)

```bash
cp .env.example .env                                  # vul INNLI_PUBLIC_URL in
docker compose up -d
docker compose logs innli                             # installatiecode voor de wizard
```

Het image werkt op gewone pc's en ARM (Raspberry Pi 4/5, Oracle Ampere). Gegevens staan in het Docker-volume `innli-data`.

### Bereikbaar maken met Cloudflare Tunnel (gratis)

1. Zet je domein op Cloudflare (gratis abonnement).
2. Cloudflare Zero Trust → *Networks → Tunnels* → *Create a tunnel* (type Cloudflared).
3. Voeg een *public hostname* toe, bijv. `innli.jouwdomein.nl`, met service `http://innli:3000` (Docker) of `http://localhost:3000` (zonder Docker).
4. Zet het token in `.env` als `TUNNEL_TOKEN` en zet `INNLI_PUBLIC_URL=https://innli.jouwdomein.nl`.
5. `docker compose --profile tunnel up -d`

Zonder Docker: installeer `cloudflared` en voer `cloudflared tunnel run --token <token>` uit.

Even testen zonder domein: `cloudflared tunnel --url http://localhost:3000` geeft een tijdelijk `trycloudflare.com`-adres.

### Back-up

Alles staat in de map `data/` (of in het Docker-volume):

- `innli.json`: instellingen, accommodaties, agentsleutels en de ondertekeningssleutel;
- `innli.*.jsonl`: aanvragen, vragen, gebeurtenissen, offertes, wachtlijst en zoekstatistieken.

Kopieer altijd **de hele map**, niet alleen `innli.json`. Het veiligst is dat terwijl INNLI stil staat, of vlak na een uur. Bestanden worden alleen aangevuld, dus een kopie tijdens het draaien mist hooguit de laatste seconden. Bijvoorbeeld met een dagelijkse taak:

```bash
tar czf backup-$(date +%F).tgz data/
# Docker:
docker compose cp innli:/app/data ./backup-$(date +%F)
```

Terugzetten: stop INNLI, zet de map terug, start INNLI.

**Automatisch:** zet `INNLI_BACKUP_DIR=/pad/naar/back-ups`, bijvoorbeeld een USB-schijf of een map die Dropbox, OneDrive of iCloud synchroniseert. INNLI kopieert dan elke dag de datamap, inclusief geüploade foto's, naar `innli-JJJJ-MM-DD`, en bewaart er `INNLI_BACKUP_KEEP` (standaard 14). De map moet buiten de datamap liggen. Met Docker koppel je die map als extra volume. De geheime licentiesleutel van de verkoper wordt nooit meegekopieerd.

## Agenda's en boekingssystemen koppelen

In het dashboard onder **Boeking & gegevens**:

| Situatie van de B&B | Kies | Wat agents de gast aanbieden |
|---|---|---|
| Houdt open kamers in een schrift, Excel of in het hoofd | *Ik houd open kamers zelf bij in INNLI*: sluit nachten per kamer onder **Kamers → Kamerkalender** | Beschikbaarheidsaanvraag |
| Verhuurt (ook) via Airbnb, Booking.com of gebruikt Google Agenda | *Mijn agenda's*: plak per kamer de iCal-exportlinks, één per regel | Beschikbaarheidsaanvraag |
| Heeft een boekingssysteem met API | *Boekingssysteem met live koppeling* (zie [koppelcontract](connector-contract.md)) | Directe boekingslink met live prijs |

Nachten die je in de kamerkalender sluit, gelden altijd, ook bovenop gekoppelde agenda's. Via de exportlink onder de kamerkalender kun je die gesloten nachten ook in Airbnb of Booking.com laten overnemen.

Draait het boekingssysteem op hetzelfde netwerk als INNLI (bijv. op dezelfde pc)? Zet dan `INNLI_ALLOW_PRIVATE_FETCH=1`. Standaard weigert INNLI verzoeken naar interne netwerkadressen, uit veiligheid.

## Bronnen

- [Hetzner-prijsverhoging juni 2026 (CX23 €5,49)](https://privatedevops.com/news/hetzner-june-2026-cloud-price-increase-what-to-do)
- [Oracle Cloud Free Tier in 2026](https://macmyths.com/oracle-cloud-free-tier-whats-actually-free-in-2026/)
- [Cloudflare Tunnel: named tunnels vereisen een domein, Quick Tunnels niet](https://flaviocopes.com/cloudflare-tunnel/)
