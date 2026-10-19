# Changelog

## 2.0.0 — 2026-10-19

Agents en accommodaties vinden elkaar. We zochten uit waar het tussen AI-agents en accommodaties het meest misgaat, en losten de tien grootste knelpunten op. Het onderzoek en de bronnen staan in [docs/agents-2.0.md](docs/agents-2.0.md).

### Vraag en aanbod
- **Verblijfswensen** (`post_stay_wish`, `get_wish_offers`, `withdraw_stay_wish`):
  - een agent laat een anonieme wens achter, zonder naam of contactgegevens;
  - passende verblijven antwoorden meteen;
  - eigenaren zien de wens in de nieuwe tab *Gezocht* en doen een aanbieding, eventueel met een eenmalige korting;
  - de agent krijgt bij elke aanbieding een verse prijs, en via `callbackUrl` een ondertekend bericht;
  - via de INNLI-gids gaat één wens naar alle installaties in de buurt.

### Sneller en zuiniger voor agents
- **Core-profiel** (`/mcp?profile=core`): 8 tools en korte instructies. Dat is ongeveer 49% minder context per beurt.
- **`detail: "brief"`:** dezelfde feiten in ongeveer 70% minder tokens.
- **Compacte JSON.**
- **`npm run measure`** toont de cijfers.
- **`nextActions`:** de volgende aanroepen met ingevulde argumenten, met wat er nog van de gast nodig is.
- **`freshness`:** hoe lang een antwoord betrouwbaar is, en hoe oud de onderliggende agenda is.
- **`timeBudgetMs` voor `search_stays`:** trage boekingssystemen houden de rest niet meer op.

### Betrouwbaar
- **Getypeerde fouten:** `code`, `retryable`, `retryAfterSeconds`, `hint` en `nextTools`, in MCP en REST. REST geeft nu passende HTTP-statussen; `error` blijft de leesbare melding.
- **RateLimit-headers** bij elk agentantwoord, en een gestructureerde 429.
- **Toestemming met een hash:**
  - elke offerte heeft `consent.summary` en `consent.hash`;
  - zijn de voorwaarden intussen veranderd, dan wordt er niets verstuurd (`TERMS_CHANGED`);
  - wat de gast goedkeurde staat in het ondertekende dossier.

### Vertrouwen en veiligheid
- **Websiteverificatie** met een metatag of een bestand. De WordPress-plugin (2.0.0) zet de tag er vanzelf op.
- **Vertrouwensblok** (`trust`) bij elk resultaat: niveau, geverifieerd domein, echte beoordelingen, waarschuwingen en veilig betalen.
- **Ondertekend paspoort:** te controleren met de sleutel in `/.well-known/innli.json`.
- **Bescherming tegen verborgen instructies:**
  - INNLI haalt instructie-achtige zinnen en onzichtbare tekens weg uit teksten van eigenaren en gasten, voordat een agent ze leest;
  - agents zien wat er is weggehaald (`contentSafety`);
  - eigenaren zien welke zinnen ze moeten herschrijven.

### Vindbaarheid
- `/.well-known/agent-card.json`, `/.well-known/mcp.json` en `/llms.txt`, op elke installatie en op de gids.
- `agent-kit/` met een Claude-plugin (skill `find-stay`) en `server.json` voor het MCP-register.

### Let op bij overstappen van 1.x
- Er zijn 19 tools in plaats van 16.
- Foutresultaten hebben nu ook `structuredContent.error`.
- REST-fouten hebben een passende status in plaats van altijd 400: 404, 409, 410, 429 en meer.
- Tekstantwoorden van MCP zijn compacte JSON.

## 1.1.0 — 2026-10-06

15 nieuwe functies.

### Meer boekingen
- **Opties met prijs:** fietshuur, lunchpakket, late check-out, kinderbedje.
  - De prijs geldt per verblijf, nacht, persoon, persoon per nacht of kamer per nacht, met een maximum.
  - Te kiezen in `get_quote`, in de aanvraag en op de verblijfspagina.
- **Kortingscodes:** geheim, niet hoofdlettergevoelig, met einddatum, minimum aantal nachten en maximaal aantal keer gebruiken.
- **Aankomstregels:** aankomstdagen per seizoen of per kamer (bijv. zaterdag tot zaterdag) en een toeslag voor één nacht.
- **Alternatieven als het vol is:** vrije verblijven in de buurt (eerst binnen 30 km, dan in het land), met prijs.
- **Eerlijke schaarste:** `fewLeft` als er nog 2 of minder kamers zijn, en het aantal checks door agents voor dezelfde data.

### Vertrouwen
- **Beoordelingen per onderdeel:** schoon, ontbijt, rust, ligging, prijs/kwaliteit en gastheer/-vrouw. De gemiddelden staan in de details, de zoekresultaten, de vergelijking en op de verblijfspagina.
- **Annuleringskosten uitgerekend:**
  - een schema bij elke prijs;
  - de kosten bij nu annuleren in `check_status` en `cancel_request`;
  - niet-restitueerbaar kost 100%.
- **Huisregels en duurzaamheid als gegevens:**
  - roken, feesten, stiltetijden en minimumleeftijd;
  - keurmerk, groene stroom, laadpaal en bereikbaar zonder auto;
  - nieuwe zoekeisen, en de antwoord-assistent kent ze.

### Gemak voor de eigenaar
- **Foto's uploaden:**
  - JPEG, PNG of WebP, gecontroleerd op de inhoud, tot 6 MB;
  - waarschuwing bij een vage beschrijving.
- **Agenda en export:** een geheime boekingsagenda (iCal) voor Google, Apple of Outlook, en een CSV-export voor Excel, beveiligd tegen formules.
- **Cijfers:** bezetting per maand en omzet per kanaal (agents, verblijfspagina, eigen website).
- **Back-ups:**
  - automatisch, dagelijks naar een tweede map (`INNLI_BACKUP_DIR`, `INNLI_BACKUP_KEEP`);
  - terugzetten vanuit het dashboard.

### Bereik
- **Beds24-koppeling (API V2):**
  - leest live beschikbaarheid, prijzen en minimaal verblijf;
  - nog te testen met een echt Beds24-account: de API is gebouwd volgens de openbare beschrijving en getest tegen een nagebouwde Beds24.
- **OAuth 2.1 voor agentplatforms:**
  - metadata, dynamische registratie en PKCE;
  - de eigenaar keurt goed als agentsleutels verplicht zijn.
- **Statusberichten:** `request_booking` neemt een `callbackUrl`; elke statuswijziging gaat daarheen, ondertekend met Ed25519.
- **Flexibel zoeken over alle verblijven:**
  - weekend, lang weekend of midweek;
  - een maximumprijs per nacht.

## 1.0.1 — 2026-10-06

WordPress-plugin, getest in WordPress 7.1.3:
- **INNLI-adres:**
  - Het adres begint leeg in plaats van met een centraal adres dat kopers niet gebruiken.
  - Zolang het niet is ingevuld, zeggen het dashboard en de pluginpagina wat er moet gebeuren.
  - Een adres als `https://…/dashboard/` wordt vanzelf opgeschoond.
- **Verbinding testen:** de instellingenpagina test de verbinding live en zegt waarom die mislukt: adres onbereikbaar, onbekend accommodatie-ID of niet gepubliceerd.
- **Aanvraagformulier:** groeit en krimpt mee met de inhoud, zonder schuifbalk erin. De verblijfspagina meldt daarvoor haar hoogte aan de website.
- **`[innli_facts]`:** krijgt een nette opmaak in twee kolommen die het thema volgt.
- **Pluginlijst:** naast *Deactiveren* staat een link *Instellingen*.

## 1.0.0 — 2026-10-06

Eerste stabiele versie. Licentiesleutels dekken versies die verschijnen binnen hun updateperiode; 1.0.0 is de basis waarop die periode telt.

### Voor agents
- MCP-server en REST met OpenAPI 3.1. Er zijn 16 tools:
  - **zoeken en vergelijken:** `search_stays`, `compare_stays`, `get_stay_details`;
  - **beschikbaarheid:** `check_availability`, `find_available_dates`, `get_availability_calendar`;
  - **prijs:** `get_quote`, met meerdere kamers, tariefplannen en 15 minuten vasthouden;
  - **boeken:** `prepare_booking`, `request_booking`, `modify_request`, `cancel_request`, `join_waitlist`;
  - **contact:** `answer_question`, `ask_host`, `report_data_issue`, `check_status`.
- Elk gegeven heeft een status: bevestigd, niet bevestigd of onbekend. Onbekend wordt nooit ingevuld.
- Een prijs vermeldt altijd of alle verplichte kosten erin zitten.
- Boekingsdossiers zijn ondertekend met Ed25519.
- Eén adres voor alle installaties via de INNLI-gids.

### Voor eigenaren
- **Dashboard** in het Nederlands en Engels.
- **Accommodatiepaspoort** en import van gegevens van de eigen website.
- **Beschikbaarheid:** een eigen kamerkalender, iCal-agenda's of een live boekingssysteem.
- **Tarieven:** seizoenen, weekendtoeslag, kortingen en tariefplannen.
- **Aanvragen:** direct bevestigen, een aanbetaling, de wachtlijst en beoordelingen.
- **Antwoord-assistent:** beantwoordt gastvragen alleen uit bevestigde gegevens en de FAQ.
- **Verblijfspagina** in vier talen, met *Vraag het ons*.
- **WordPress-plugin.**
- **Valuta:** 15 valuta. INNLI rekent nooit om.

### Voor hotels
- Kamertypes met meerdere kamers en stop-sell.
- Personeelssleutels voor receptie en manager.
- Ondertekende webhooks naar een PMS of channel manager.
- Licentiepakketten Hotel en Hotelgroep.

### Verkoop
- Eenmalige licenties van € 99 tot € 1.499.
- Een verkooppakket (zip) dat zonder `npm install` draait.
- Een Docker-image voor x86 en ARM.
