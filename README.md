# INNLI

AI-native booking infrastructure for B&Bs and independent stays — making properties discoverable, understandable and bookable by AI agents.

> Maak jouw B&B toegankelijk voor AI-reisagents — met je eigen website, prijzen en boekingssysteem.

English: [README.en.md](README.en.md).

INNLI is geen chatbot en geen nieuw hotelsysteem. Het is een **accommodatiepaspoort** dat de eigenaar zelf controleert, **één MCP-koppeling** waarmee aangesloten AI-agents dat paspoort kunnen doorzoeken, prijzen en beschikbaarheid kunnen opvragen en een boekingslink kunnen klaarzetten, plus een **WordPress-plugin** en een **dashboard** voor de eigenaar.

Vindbaar zijn, door een agent begrepen worden en daadwerkelijk geboekt kunnen worden zijn drie verschillende dingen. INNLI ondersteunt de hele route.

**Verdienmodel: eenmalige koop, geen SaaS.** De B&B draait INNLI zelf (Raspberry Pi, eigen pc of server) en activeert een licentie. De verkoper host alleen de kleine **INNLI-gids**: één adres voor agents dat doorverwijst naar alle zelf-gehoste B&B's.

## Wat er in deze versie zit

| Onderdeel | Wat het doet |
|---|---|
| **Accommodatiepaspoort** (`src/domain`) | ~40 concrete gegevens (afgesloten tuin, bedlengte, treden naar de kamer, toeristenbelasting…). Ieder gegeven heeft een status (`bevestigd` / `niet bevestigd` / `onbekend`), een bron, bewijs en een controledatum. Onbekend blijft onbekend. Na een jaar vraagt INNLI om opnieuw te controleren. |
| **Agentkoppeling (MCP + REST)** (`src/mcp`) | 19 tools in zes groepen:<br>• zoeken en vergelijken: `search_stays` met flexibele data, "in de buurt van" en groepen over 2–3 kamers; `compare_stays`; `get_stay_details` met foto's, omgeving, FAQ, beoordelingen en vertalingen;<br>• beschikbaarheid: `check_availability`, `find_available_dates`, `get_availability_calendar`;<br>• prijs: `get_quote`, met kortingen, meerdere kamers, tariefplannen en 15 minuten vasthouden;<br>• boeken: `prepare_booking`, `request_booking` (ook als groep, alles of niets), `modify_request`, `cancel_request`, `join_waitlist`;<br>• contact: `answer_question` (antwoord-assistent), `ask_host`, `report_data_issue`, `check_status` met ondertekend boekingsdossier en alternatieven;<br>• vraag en aanbod: `post_stay_wish`, `get_wish_offers`, `withdraw_stay_wish`.<br>Dezelfde tools zijn er als REST met OpenAPI 3.1 voor agents zonder MCP. Daarnaast MCP-resources (`innli://stay/{id}`) en een `plan_stay`-prompt. Rechten per agentsleutel (`read`/`act`). Zie [docs/agent-features.md](docs/agent-features.md) voor alle 300 agentfuncties en hun status. |
| **Prijsberekening** (`src/domain/pricing.ts`) | Gespecificeerde totaalprijs inclusief verplichte toeslagen, met geldigheidsduur. Ontbreekt een verplichte post, dan staat `totalIncludesAllMandatoryCosts: false` erbij in plaats van een te lage prijs. |
| **Agenda's en boekingssystemen** (`src/connectors`) | *Live API* (boekingssysteem): live beschikbaarheid en tarieven → directe boekingslink. *Agenda's*: meerdere iCal-feeds per kamer (Airbnb, Booking.com, Google Agenda) → beschikbaarheidsaanvraag. *Eigen kamerkalender*: open/dicht per nacht in het dashboard, met exportlink voor Airbnb/Booking.com. *Geen koppeling*: aanvraag per mail of formulier. |
| **Boekingslinks & meting** (`src/booking`, `src/analytics`) | Getrackte doorverwijzing naar de eigen boekingsomgeving met datums en gasten ingevuld. Funnel houdt agentaanvragen, doorkliks en bevestigde boekingen strikt uit elkaar; een boeking telt alleen als website of boekingssysteem die ondertekend terugmeldt. |
| **Vindbaarheidscheck** (`src/readiness/audit.ts`) | robots.txt per crawler, met onderscheid tussen **zoek**crawlers (OAI-SearchBot, Claude-SearchBot, PerplexityBot, Googlebot, Bingbot) en **trainings**crawlers (GPTBot, ClaudeBot, Google-Extended, CCBot); noindex, titel, sitemap, kamerpagina's, zichtbare prijzen/voorwaarden, schema.org en consistentie met het paspoort. Belooft nooit een ranking. |
| **Website-import** (`src/readiness/extract.ts`) | Maakt van bestaande websitetekst een conceptpaspoort. Alles komt binnen als *niet bevestigd*, met het tekstfragment als bewijs, en overschrijft nooit iets wat de eigenaar al bevestigde. |
| **Dashboard** (`public/dashboard`) | Nederlandstalig: paspoortkwaliteit, funnel, gegevens bevestigen, kamers, boekingskoppeling testen, vindbaarheid, en precies zien wat een agent te zien krijgt. |
| **WordPress-plugin** (`wordpress-plugin/innli`) | schema.org uit bevestigde feiten + shortcode `[innli_facts]` om dezelfde feiten zichtbaar te tonen, AI-crawlerinstellingen (zoeken en training los), crawlerbezoeken apart tellen, en boekingen terugmelden met `[innli_conversion]`. |
| **Betrouwbaar boeken** (`src/requests`) | Op basis van [onderzoek naar knelpunten](docs/onderzoek-knelpunten.md): kamer vasthouden tijdens een aanvraag met automatische vervaltijd, *direct bevestigen* volgens regels van de eigenaar, aanbetaling met eigen betaalinstructies/-link, annuleren met toestemming, boekingsdossier (prijs, voorwaarden, toestemming), logboek van agentacties, herinneringen (eigenaar, gast vóór aankomst), waarschuwing bij dubbele boeking met andere kanalen, reactietijd zichtbaar voor agents. |
| **Inzichten** (`src/analytics/insights.ts`) | *Wat agents zoeken*: welke eisen gasten stellen, hoe vaak je getoond werd, en welke onbekende gegevens je gasten kostten, met wat je moet bevestigen. Plus een consistentiecheck tussen website en paspoort. |
| **Aanvragen & inbox** (`src/requests`) | Voor B&B's zonder boekingssysteem: gasten (via een agent of de verblijfspagina) sturen een aanvraag met live prijs; de eigenaar accepteert of wijst af in het dashboard. Accepteren sluit de nachten in de kamerkalender (en via de exportlink op Airbnb/Booking.com) en telt als bevestigde boeking. Optioneel e-mail via de eigen mailbox (SMTP). Gastgegevens worden na de bewaartermijn automatisch gewist. |
| **Verblijfspagina** (`src/web`) | Eigen publieke pagina per accommodatie met kamers, bevestigde feiten, schema.org, beschikbaarheidskalender, live prijsberekening en aanvraagformulier. In te sluiten op de eigen site (`?embed=1`, WordPress `[innli_request]`). |
| **Hotels en drukke accommodaties** ([docs/hotels.md](docs/hotels.md)) | Kamertypes met meerdere kamers (beschikbaarheid per nacht geteld, stop-sell), tariefplannen (niet-restitueerbaar, met ontbijt), kamers 15 minuten vasthouden, wijzigen zonder eerst te annuleren, personeelssleutels (receptie/manager), ondertekende webhooks naar een PMS of channel manager, en hotelpakketten in de licentie. Gemeten: beschikbaarheid voor een hotel met 300 kamers en 10.000 boekingen in ~1 ms. |
| **Nieuw in 2.0: agents en accommodaties vinden elkaar** ([docs/agents-2.0.md](docs/agents-2.0.md)) | Tien knelpunten uit onderzoek, opgelost:<br>• *verblijfswensen*: agents laten een anonieme wens achter, en eigenaren doen er in het dashboard een aanbieding op, eventueel met korting;<br>• *core-profiel* en compacte antwoorden: ~49% minder context per beurt en ~70% kleinere antwoorden;<br>• `nextActions` met ingevulde argumenten en `freshness` bij elk antwoord;<br>• getypeerde fouten met `retryable` en `hint`, plus RateLimit-headers;<br>• toestemming met een hash over de voorwaarden;<br>• websiteverificatie (de WordPress-plugin doet het vanzelf), een vertrouwensblok en een ondertekend paspoort;<br>• bescherming tegen verborgen instructies in teksten;<br>• een tijdsbudget voor zoeken;<br>• agent-card, MCP-serverkaart, `llms.txt` en een Claude-plugin ([agent-kit](agent-kit/README.md)). |
| **Nieuw in 1.1** | Opties met prijs (fiets, lunchpakket, late check-out), geheime kortingscodes, aankomstdagen en toeslag voor één nacht, annuleringskosten uitgerekend, alternatieven als het vol is, eerlijke schaarste ("nog 2 kamers"), beoordelingen per onderdeel, huisregels en duurzaamheid als gegevens, zoeken op "lang weekend" en prijs per nacht, foto's uploaden met controle op vage beschrijvingen, boekingsagenda (iCal), CSV-export, bezetting en omzet per kanaal, automatische back-ups en terugzetten, Beds24-koppeling, OAuth 2.1 voor agentplatforms en ondertekende statusberichten. Zie [CHANGELOG.md](CHANGELOG.md). |
| **Antwoord-assistent** (`src/requests/answers.ts`) | Beantwoordt gastvragen meteen in vier talen, alleen uit bevestigde gegevens en de FAQ van de eigenaar; geen taalmodel, niets verzonnen. Wat onbekend is gaat naar de eigenaar, met een concept van wat al bekend is. Ook als *Vraag het ons* op de verblijfspagina. |
| **Tarieven** (`src/domain/rates.ts`) | Seizoenen (ook over de jaargrens), weekendtoeslag, minimaal aantal nachten per seizoen, en kortingen voor lang verblijf, last minute en vroegboeken. |
| **Gastervaring** (`src/requests`) | Wachtlijst met automatische mail bij een vrije kamer; beoordelingen alleen van gasten met een geaccepteerde boeking (met reactie van de eigenaar); antwoorden op gastvragen als openbare FAQ; foto's, plekken in de buurt en vertalingen (en/de/fr). |
| **Eigenaar op de hoogte** | Pushmeldingen op de telefoon via ntfy; maandoverzicht per mail; export voor Google Bedrijfsprofiel. |
| **Ondertekende dossiers** (`src/security`) | Ieder boekingsdossier is ondertekend met Ed25519. De publieke sleutel staat in `/.well-known/innli.json`, zodat agents prijs en voorwaarden zelf kunnen controleren. |
| **Talen** (`src/i18n`) | Gasten: verblijfspagina, e-mails en statuspagina's in het Nederlands, Engels, Duits en Frans, met taalkeuze en hreflang. Agents: Engels (instelbaar). Eigenaren: dashboard, e-mails en maandoverzicht in het Nederlands of Engels. |
| **Valuta** | Per accommodatie: EUR, GBP, CHF, DKK, SEK, NOK, PLN, CZK, HUF, RON, ISK, USD, CAD, AUD of NZD, standaard die van het land. INNLI rekent nooit om; een budget wordt alleen binnen één valuta vergeleken. |
| **Snel** | Append-only opslag met indexen, en parallelle live controles. Gemeten tot 10.000× sneller schrijven en 9× sneller zoeken bij live boekingssystemen; zie [docs/prestaties.md](docs/prestaties.md) en `npm run bench`. |
| **Installatiewizard** | Eerste start in de browser met een eenmalige installatiecode uit de console; stappenlijst *Aan de slag*; back-up downloaden. |
| **Licenties** (`src/licensing`, `tools/license.ts`) | Eenmalige koop met offline te controleren licentiesleutels (Ed25519). Eeuwig geldig voor versies uit de updateperiode. Zonder licentie werkt alles lokaal (proefversie), maar staat de B&B niet in de gids. |
| **INNLI-gids** (`src/directory`) | Eén MCP-adres voor agentpartners. Zelf-gehoste installaties melden zich aan (licentie en eigendom van het adres worden gecontroleerd); vragen worden live doorgestuurd. De gids bewaart geen prijzen, agenda's of gastgegevens. |
| **Demo-boekingssysteem** (`src/demo`) | Een nep-boekingssysteem dat het live-contract implementeert, iCal-feeds en demo-websites serveert, en boekingen terugmeldt. Drie fictieve accommodaties tonen bevestigde, onbevestigde en onbekende gegevens. |

## Snel starten

Vereist Node.js ≥ 22.18 (TypeScript draait direct, zonder buildstap).

**Eigen accommodatie, lokaal of op een server:**

```bash
npm install --omit=dev
npm start           # toont een installatiecode; open http://localhost:3000/dashboard/
```

De wizard in de browser vraagt de installatiecode, de naam en je eerste kamer, en geeft je eigenaarssleutel. (Liever de terminal: `npm run setup`.) Daarna: **[docs/handleiding.md](docs/handleiding.md)**.

Of met Docker: `docker compose up -d`, dan `docker compose logs innli` voor de installatiecode. Om agents erbij te laten moet INNLI 24/7 online bereikbaar zijn; zie **[docs/hosting.md](docs/hosting.md)** voor de goedkoopste opties (vanaf €0 aan hosting met een eigen pc/Raspberry Pi of Oracle Free + Cloudflare Tunnel) en hoe je agenda's koppelt.

**Demo met drie fictieve accommodaties:**

```bash
npm install
npm run demo        # start met demodata op http://localhost:3000
```

- Dashboard: <http://localhost:3000/dashboard/> — eigenaarssleutels staan in `data/demo-credentials.json`
- MCP-endpoint voor agents: `http://localhost:3000/mcp` (Streamable HTTP)

Agent lokaal proberen met MCP Inspector:

```bash
npx @modelcontextprotocol/inspector     # kies Streamable HTTP → http://localhost:3000/mcp
```

Of in Claude Code:

```bash
claude mcp add --transport http innli http://localhost:3000/mcp
```

Vraag dan bijvoorbeeld: *"Zoek een kleinschalig verblijf op de Veluwe voor twee nachten, met ontbijt, een afgesloten tuin voor mijn hond en een slaapkamer op de begane grond. Maximaal €350 inclusief alle kosten."* De agent vindt B&B De Hooiberg (alles bevestigd, live prijs, directe boekingslink) en Logies Het Kraaiennest (tuin niet bevestigd door de eigenaar, schoonmaakkosten onbekend — en dat zegt hij erbij).

## Ontwikkelen

```bash
npm test            # unit- en end-to-endtests (MCP over HTTP, boekingsflow, eigenaar-API)
npm run typecheck
npm run lint:php    # WordPress-plugin
npm run pakket -- --concept   # downloadpakket (zip) proberen in dist/
npm run bench       # prestaties meten (300 accommodaties, 200.000 gebeurtenissen)
```

### Configuratie

| Variabele | Standaard | Betekenis |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | |
| `INNLI_PUBLIC_URL` | `http://localhost:$PORT` | Basis voor boekingslinks (`/r/…`) |
| `INNLI_LANG` | `nl` | Taal van de installatie: console, e-mails aan eigenaren zonder taal, pagina's zonder browservoorkeur (`nl`, `en`, `de`, `fr`) |
| `INNLI_AGENT_LANG` | `en` | Taal van teksten voor agents |
| `INNLI_DATA` | `data/innli.json` | Gegevensbestand; aanvragen, gebeurtenissen enz. staan ernaast in `innli.*.jsonl`. Back-up = de hele map. |
| `INNLI_ADMIN_KEY` | – | Vereist voor `/api/admin` (accommodaties en agentsleutels aanmaken) |
| `INNLI_REQUIRE_AGENT_KEY` | – | `1` = alleen agents met sleutel mogen de MCP-koppeling gebruiken |
| `INNLI_DEMO` | – | `1` = Nederlandse demodata, `intl` = zeven Europese voorbeeldaccommodaties (`npm run demo:intl`); met demo-boekingssysteem, staat ook verzoeken naar lokale adressen toe |
| `INNLI_ALLOW_PRIVATE_FETCH` | – | `1` = boekingssysteem of agenda op het eigen netwerk mag worden aangesproken |
| `INNLI_GIDS_URL` | – | Adres van de INNLI-gids; met een geldige licentie meldt de installatie zich daar aan |
| `INNLI_SMTP_URL` | – | E-mail voor aanvragen, bijv. `smtps://info%40mijnbnb.nl:wachtwoord@mail.provider.nl:465` |
| `INNLI_MAIL_FROM` | SMTP-gebruiker | Afzender van e-mails |
| `INNLI_BEWAARTERMIJN_DAGEN` | `180` | Na hoeveel dagen na het verblijf gastgegevens worden gewist (min. 30) |
| `INNLI_BACKUP_DIR` | – | Map buiten de datamap voor een dagelijkse automatische back-up (USB-schijf, NAS, gesynchroniseerde map) |
| `INNLI_BACKUP_KEEP` | `14` | Aantal dagelijkse back-ups dat bewaard blijft |

Beheer via de commandoregel: `npm run innli -- lijst`, `npm run innli -- nieuwe-sleutel <id>`, `npm run innli -- agent "Naam"`, `npm run innli -- licentie <sleutel>` (Engels: `list`, `new-key`, `agent`, `license`). Stop de server eerst; die houdt zijn gegevens in het geheugen.

### Een accommodatie of agentpartner toevoegen

```bash
curl -X POST localhost:3000/api/admin/properties -H "authorization: Bearer $INNLI_ADMIN_KEY" \
  -H 'content-type: application/json' -d '{"name":"B&B Het Veerhuis","address":{"city":"Zwolle","country":"NL"}}'
# → { property, ownerKey }  (sleutel wordt één keer getoond)

curl -X POST localhost:3000/api/admin/agents -H "authorization: Bearer $INNLI_ADMIN_KEY" \
  -H 'content-type: application/json' -d '{"name":"Reisplatform X"}'
# → { key }  agent gebruikt: Authorization: Bearer <key> op /mcp
```

## Productprincipes in de code

1. **Onbekend blijft onbekend.** Agents krijgen per accommodatie een expliciete lijst `unknown`. Een onbevestigd "nee" telt niet als betrouwbaar nee; een onbevestigd "ja" heet `unverified`.
2. **Alleen de eigenaar bevestigt.** Import en koppelingen leveren suggesties; die overschrijven nooit een bevestigd gegeven.
3. **Geen boekingsbelofte op verouderde gegevens.** Een directe boekingslink alleen bij live gecontroleerde beschikbaarheid; iCal levert een aanvraag op.
4. **Niets wordt via INNLI geboekt zonder de eigenaar.** `prepare_booking` geeft `status: "not_booked"`; de gast rondt af bij de accommodatie, of stuurt een aanvraag die de eigenaar accepteert. Gastgegevens staan alleen op de eigen installatie van de B&B en worden na de bewaartermijn gewist; agents en de gids krijgen ze nooit.
5. **Meten wat echt is.** Crawlerbezoeken ≠ gasten; agentaanvragen ≠ doorkliks ≠ bevestigde boekingen.
6. **Geen rankingbeloftes.** De vindbaarheidscheck gaat over technische toegankelijkheid en kwaliteit van gegevens.

## Documentatie

- English: [`README.en.md`](README.en.md), [`docs/en/`](docs/en/) (installatie, handleiding, hosting, agentintegratie)
- [`CHANGELOG.md`](CHANGELOG.md) — wat er in elke versie zit
- [`docs/installeren.md`](docs/installeren.md) — installeren voor kopers (zip of Docker)
- [`docs/handleiding.md`](docs/handleiding.md) — handleiding voor de B&B-eigenaar
- [`docs/hotels.md`](docs/hotels.md) — voor hotels: kamertypes, tariefplannen, antwoord-assistent, personeel, webhooks naar je PMS
- [`docs/onderzoek-knelpunten.md`](docs/onderzoek-knelpunten.md) — knelpunten bij boeken via AI-agents en hoe INNLI ze oplost (met bronnen)
- [`docs/agents-2.0.md`](docs/agents-2.0.md) — de tien grootste knelpunten tussen agents en accommodaties, en hoe 2.0 ze oplost (met bronnen)
- [`agent-kit/`](agent-kit/README.md) — Claude-plugin, MCP-register (`server.json`) en wat agents in 2.0 krijgen
- [`docs/agent-features.md`](docs/agent-features.md) — 300 agentfuncties en hun status
- [`docs/prestaties.md`](docs/prestaties.md) — benchmarks vóór en na 0.6
- [`docs/hosting.md`](docs/hosting.md) — lokaal of online draaien, kosten, tunnel, agenda's koppelen
- [`docs/agent-integration.md`](docs/agent-integration.md) — voor bouwers van reisagents
- [`docs/connector-contract.md`](docs/connector-contract.md) — live-koppeling voor boekingssystemen, boekingslinks en terugmelding

## Bewust nog niet gebouwd

- Reserveringen rechtstreeks in een extern boekingssysteem (wel: elke boeking via een ondertekende webhook naar je PMS, zodat die hem kan overnemen). Via INNLI zelf kan het wel: aanvragen of direct bevestigen met toestemming van de gast, en `booked: true` pas na acceptatie.
- Koppelingen met specifieke boekingssystemen; de live-API is het contract dat zo'n adapter moet implementeren.
- Publicatie in ChatGPT/Claude-appdirectories: een werkende MCP-server is niet hetzelfde als een goedgekeurde, gepubliceerde koppeling.
- Productie-opslag op een database: de bestandsopslag (JSON + JSONL met indexen) is gemeten met 300 accommodaties en 200.000 gebeurtenissen, en heeft een smalle interface om naar Postgres te verhuizen.
