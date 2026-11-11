# INNLI 2.1: weten welke agent er belt, vasthouden zonder misbruik, en UCP voor verblijven (onderzoek november 2026)

Voor 2.1 keken we wat andere projecten en standaarden bieden aan AI-agents die accommodaties boeken, en wat er voor de sector nog niet is opgelost. Hier staat wat we vonden, wat INNLI 2.1 eraan doet, en wat het bewust nog niet doet.

## Wat anderen bieden

| Project of standaard | Wat een agent krijgt | Wat ontbreekt voor een kleine accommodatie |
|---|---|---|
| Airbnb MCP-server (openbnb, community) | Zoeken en details, door de site uit te lezen | Geen boeking, geen toestemming van de eigenaar, geen bevestigde gegevens |
| Koppelingen van Booking.com en Expedia | Zoeken; boeken gebeurt op hun site | De accommodatie betaalt commissie en heeft gast noch gegevens zelf |
| 1Stay (Stayker) | `book_hotel` geeft een link naar een gehoste betaalpagina | Een tussenpartij die een vergoeding vraagt |
| HemmaBo | Verhuur van eigenaren, met ondertekende aanbiedingen | Gehost, niet iets wat een accommodatie zelf draait |
| Apaleo MCP | Taken voor hotelpersoneel (reserveringen, tarieven) | Niet bedoeld voor de agent van een gast |
| UCP voor verblijven (concept, `dev.ucp.lodging.booking`) | Een protocol met boekingssessies: verblijven, totalen, voorwaarden, betaaltermijnen, afronden | Er moet bij de accommodatie een server staan die het spreekt |
| ACP (OpenAI/Stripe) | Afrekensessies voor producten, met betaaltokens | Kent geen data, kamers of gezelschap |
| AP2 (Google) | Ondertekende mandaten die bewijzen wat de koper goedkeurde | Vraagt een partij die bewijzen uitgeeft en een tweede soort sleutel |
| Web Bot Auth (HTTP Message Signatures, RFC 9421) | Een agent bewijst wie hij is met een sleutel op zijn eigen domein | De server van de accommodatie moet dat controleren |

Het gat: er is niets dat je zelf draait, open source, waarmee een onafhankelijke accommodatie op eigen voorwaarden aan deze protocollen meedoet. Alles wat boekt, loopt via een tussenpartij.

## De vijf grootste open knelpunten, en wat 2.1 doet

### 1. Een accommodatie weet niet welke agent er belt
Een user-agent bewijst niets. En elk platform bij elke B&B een sleutel laten aanvragen is niet te doen.

**INNLI 2.1** controleert handtekeningen van Web Bot Auth:
- De agent stuurt `Signature-Agent`, `Signature-Input` en `Signature` mee (RFC 9421, Ed25519, `tag="web-bot-auth"`). Zijn sleutels staan als JWKS op `<zijn adres>/.well-known/http-message-signatures-directory`.
- Een bewezen platform krijgt een eigen limiet (600 verzoeken per minuut in plaats van 120 per adres), zodat zijn gebruikers elkaar niet blokkeren.
- Het bewezen domein komt in het ondertekende boekingsdossier (`consent.agentIdentity`, `consent.agentDomain`). Bij een geschil is duidelijk welk platform de aanvraag stuurde.
- Een kapotte handtekening is geen fout: het verzoek wordt als anoniem behandeld, en de antwoordheader `x-innli-agent-identity` zegt waarom (`expired`, `bad_signature`, `replayed_nonce`, …).
- Eigenaren kunnen in het dashboard *Alleen herkenbare agents* aanzetten. Anonieme agents kunnen dan nog zoeken en prijzen opvragen, maar voor een aanvraag is een sleutel of handtekening nodig (`AGENT_IDENTITY_REQUIRED`).
- INNLI zet zijn eigen sleutels op dezelfde vaste plek en ondertekent statusberichten ook met RFC 9421 (`Content-Digest`, `Signature-Input`, `Signature`). Ontvangers kunnen ze met een standaardbibliotheek controleren.

### 2. Kamers vasthouden zonder te boeken
Een agent die elke kamer "aanvraagt", houdt echte gasten buiten zolang de kamer wordt vastgehouden. Voor een kleine accommodatie is dat de goedkoopste manier om schade te lijden. Vóór 2.1 deelden alle anonieme agents bovendien één limiet, zodat één drukke beller de rest blokkeerde.

**INNLI 2.1:**
- Open aanvragen zijn begrensd per houder en per accommodatie: 2 voor een anoniem adres, 25 voor een herkenbare agent, 3 per e-mailadres van een gast. De fout is `LIMIT_REACHED`, met `check_status` en `cancel_request` als volgende stap.
- Een anonieme agent kan niet meer dan de helft van de kamers tegelijk vasthouden.
- Anonieme agents worden per adres geteld, niet samen.
- Het dashboard toont per agent hoeveel prijsopvragen en aanvragen een boeking werden, en hoeveel er vervielen of werden geannuleerd (`GET /api/owner/agents`).
- Kort vasthouden telt ook mee: `get_quote({ hold: true })` en UCP-sessies houden kamers 15 minuten vast zonder gegevens van een gast. Een anoniem adres mag er 3 tegelijk hebben, een herkenbare agent 60.
- Adressen worden alleen als hash bewaard.

### 3. Geen boekingsprotocol dat een accommodatie zelf kan aanbieden
Agentplatforms gaan naar afrekenen in sessies. UCP heeft een concept voor verblijven, met de onderdelen die een verblijf nodig heeft.

**INNLI 2.1** voegt op elke installatie een UCP-adapter toe:
- Profiel op `/.well-known/ucp`; REST-adres `/ucp/v1`; dezelfde handelingen als MCP-tools op `/ucp/mcp` (`create_booking_session`, `get_…`, `update_…`, `complete_…`, `cancel_…`).
- `POST /booking-sessions`, `GET` en `PUT /booking-sessions/{id}`, `POST …/complete`, `POST …/cancel`.
- Een sessie is één of meer INNLI-offertes waarbij de kamers 15 minuten worden vastgehouden (`expires_at`). Gelijke kamers en maximaal drie kamertypes passen in één sessie.
- `totals[]` in de kleinste munteenheid, die precies optellen tot het ene `total`; toeristenbelasting en kosten als eigen regels.
- `policies[]` met `refundability` (`refundable`, `partially_refundable`, `non_refundable`). Heeft de eigenaar alleen een tekst, dan raadt INNLI niet: de tekst gaat mee als mededeling.
- `payment.terms[].schedules[]` zeggen wat er aan de accommodatie wordt betaald en wanneer (aanbetaling, rest ter plaatse). Er zijn geen betaalhandlers; platforms ronden af met `payment: {}`.
- De status volgt de boeking: `incomplete` → `ready_for_complete` → `completed` bij direct bevestigen, of `complete_in_progress` zolang de eigenaar beslist. Een accommodatie met een eigen boekingssysteem geeft `requires_escalation` met een `continue_url`.
- Afronden stuurt dezelfde aanvraag als `request_booking`: dezelfde toestemmingshash, limieten en hetzelfde ondertekende dossier.

De standaard is een concept en zal nog veranderen. Zet `INNLI_UCP_VERSION` op de versie die je platform verwacht.

### 4. Opnieuw proberen en dan dubbel boeken
Na een time-out weet een agent niet of de boeking is gelukt.

**INNLI 2.1** accepteert een `Idempotency-Key`-header bij REST-tools en UCP:
- dezelfde sleutel en dezelfde inhoud: het eerste antwoord, met `Idempotent-Replayed: true`;
- dezelfde sleutel en andere inhoud: `409`;
- antwoorden blijven 24 uur bewaard. Serverfouten en limieten worden niet bewaard, zodat opnieuw proberen kan;
- bij `request_booking` wordt de header ook bij de aanvraag bewaard, zodat opnieuw proberen ook na een herstart veilig is.

### 5. Annuleringsvoorwaarden die een agent moet ontleden
**INNLI 2.1** voegt aan elke offerte `cancellation` toe: `refundability`, `freeUntil` en wat annuleren vandaag kost. `unknown` als de eigenaar geen regels in cijfers heeft.

### Via de INNLI-gids
De gids geeft verzoeken van veel agents door vanaf één adres. Zonder maatregel zou elke agent erachter bij elke installatie één limiet delen.
- De gids controleert zelf handtekeningen van Web Bot Auth en ondertekent elk verzoek dat hij doorgeeft met zijn eigen sleutel (te vinden op zijn `/.well-known/http-message-signatures-directory`).
- De handtekening dekt wat de gids over de beller zegt: de naam, het domein dat de gids controleerde, en een gehasht kenmerk van de beller.
- Een installatie vertrouwt dit alleen van de gids waarin ze is opgenomen (`INNLI_GIDS_URL`). Van ieder ander betekenen deze headers niets.
- Een bewezen platform blijft dus bewezen via de gids, en limieten tellen per beller.
- Draai je een eigen gids, zet dan `GIDS_PUBLIC_URL` op het openbare adres.

## Zelf een installatie controleren
`npx innli-conformance https://verblijf.example` doet 14 controles die alleen lezen: vindbaarheidsdocumenten, sleutelmap, MCP-profielen, getypeerde fouten, controle van handtekeningen, idempotentie, het ondertekende paspoort en het UCP-profiel. Er wordt niets geboekt. Afsluitcode 1 als een controle faalt.

## Wat 2.1 bewust niet doet
- **Mandaten van AP2.** Daar is een uitgever van bewijzen en een tweede soort sleutel voor nodig. Kaartgaranties via betaaltokens van ACP zijn na 2.1 toegevoegd: zie [acp.md](../acp.md) (Engels).
- **Ondertekende UCP-antwoorden.** Verzoeken worden gecontroleerd; antwoorden worden nog niet ondertekend.
- **De nieuwste MCP-revisie.** INNLI volgt de officiële SDK.

## Bronnen
Specificaties, gelezen in hun openbare repositories (november 2026): Universal-Commerce-Protocol/ucp (lodging booking, cancellation policy, signatures), agentic-commerce-protocol/agentic-commerce-protocol, google-agentic-commerce/AP2, cloudflare/web-bot-auth, visa/trusted-agent-protocol, modelcontextprotocol/modelcontextprotocol. Projecten: openbnb-org/mcp-server-airbnb, STAYKER-COM/1Stay-mcp, HemmaBo-se/hemmabo-mcp-server. RFC 9421 (HTTP Message Signatures), RFC 9530 (Digest Fields), RFC 7638 (JWK Thumbprint).
