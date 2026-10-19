# 300 functies voor AI-agents

Status: ✅ gebouwd en getest · 🔜 volgende stap (hoogste waarde) · 💡 later

Uitgangspunt bij elke functie: een agent moet een gast **eerlijk** kunnen helpen. Wat bevestigd is noemt hij als feit, wat onbekend is zegt hij erbij, en niets heet geboekt tot de eigenaar het bevestigt.

**Stand deel 1: 87 gebouwd, 1 volgende stap, 12 later. Totaal (300): 214 gebouwd (bijgewerkt in 1.1).**

## A. Zoeken en matchen

| # | Functie | Status | Tool / plek |
|---|---|---|---|
| 1 | Zoeken op plaats, regio of land | ✅ | `search_stays` |
| 2 | Zoeken rond een punt met straal (km) | ✅ | `search_stays.near` |
| 3 | 13 harde eisen: hond, afgesloten tuin, begane grond, drempelvrij, inloopdouche, lang bed, eigen badkamer/ingang, rustig, parkeren, ontbijt, kinderen | ✅ | `search_stays.requirements` |
| 4 | Eisen automatisch afgeleid uit het gezelschap (honden, kinderen) | ✅ | `search_stays` |
| 5 | Per eis: bevestigd / onbevestigd / onbekend / niet | ✅ | `criteria[].level` |
| 6 | Alleen door de eigenaar bevestigde matches | ✅ | `confirmedOnly` |
| 7 | Budget inclusief alle verplichte kosten | ✅ | `maxTotalPrice` |
| 8 | Sorteren op beste match, prijs of afstand | ✅ | `sort` |
| 9 | Uitleg waarom accommodaties afvielen (bezet, boven budget) | ✅ | `excluded` |
| 10 | Meerdere kamers voor één groep (gezin van 5 → 2 kamers) | ✅ | search_stays (rooms), get_quote rooms |

## B. Beschikbaarheid en data

| # | Functie | Status | Tool / plek |
|---|---|---|---|
| 11 | Live beschikbaarheid uit het boekingssysteem | ✅ | `check_availability` |
| 12 | Meerdere agenda's per kamer (Airbnb, Booking.com, Google Agenda) | ✅ | iCal-koppeling |
| 13 | Kamerkalender die de eigenaar zelf bijhoudt | ✅ | dashboard |
| 14 | Zekerheid per antwoord: live, gesynchroniseerd of geen bron | ✅ | `certainty` |
| 15 | Flexibele data: alle mogelijke aankomstdagen in een periode, met prijs | ✅ | `find_available_dates` |
| 16 | Alleen weekenden | ✅ | `weekendsOnly` |
| 17 | Maandkalender per kamer met prijs per nacht | ✅ | `get_availability_calendar` |
| 18 | Onleesbare agenda = onbekend, nooit "vrij" | ✅ | |
| 19 | Flexibele data over meerdere accommodaties tegelijk | ✅ | search_stays flexibleDates (+ pattern) |
| 20 | Wachtlijst: bericht als een kamer vrijkomt | 💡 | |

## C. Prijs en offerte

| # | Functie | Status | Tool / plek |
|---|---|---|---|
| 21 | Gespecificeerde totaalprijs met alle verplichte kosten | ✅ | `get_quote` |
| 22 | Markering als een verplichte post onbekend is | ✅ | `totalIncludesAllMandatoryCosts` |
| 23 | Live tarieven per nacht | ✅ | live-koppeling |
| 24 | Seizoenen, weekendtoeslag, minimaal aantal nachten | ✅ | tarieven eigenaar |
| 25 | Prijs per nacht in de offerte | ✅ | `nightly` |
| 26 | Geldigheidsduur van de offerte | ✅ | `validUntil` |
| 27 | Voorwaarden in de offerte: annulering, in- en uitchecken, honden, dieetwensen, voordeel bij direct boeken | ✅ | `policies` |
| 28 | Kant-en-klare samenvatting voor de gast | ✅ | `summaryForGuest` |
| 29 | Kortingen: lang verblijf, last minute | ✅ | get_quote (discount) |
| 30 | Aanbetaling met betaalinstructies of betaallink van de eigenaar (tegen no-shows) | ✅ | `payment` |

## D. Informatie over het verblijf

| # | Functie | Status | Tool / plek |
|---|---|---|---|
| 31 | Paspoort met ±40 concrete gegevens | ✅ | `get_stay_details` |
| 32 | Bron, bewijs en controledatum per gegeven | ✅ | |
| 33 | Expliciete lijst van onbekende beslissende gegevens | ✅ | `facts.unknown` |
| 34 | Signaal als een gegeven langer dan een jaar niet gecontroleerd is | ✅ | `needsRecheck` |
| 35 | Kamerniveau: bedlengte, treden, deurbreedte, douche, geluid | ✅ | |
| 36 | Accommodaties naast elkaar vergelijken | ✅ | `compare_stays` |
| 37 | Foto's per kamer met beschrijving | ✅ | get_stay_details photos |
| 38 | Afstanden tot station, strand, centrum (door eigenaar bevestigd) | ✅ | pointsOfInterest, nearPlace |
| 39 | Omschrijvingen in meerdere talen door de eigenaar | 💡 | |
| 40 | Ervaringen van gasten met een geverifieerd verblijf | 💡 | |

## E. Boeken en aanvragen

| # | Functie | Status | Tool / plek |
|---|---|---|---|
| 41 | Directe boekingslink met ingevulde data en gasten | ✅ | `prepare_booking` |
| 42 | Aanvraag via de eigen verblijfspagina | ✅ | `prepare_booking` |
| 43 | Aanvraag versturen vanuit de agent, met toestemming van de gast | ✅ | `request_booking` |
| 44 | Geen dubbele aanvragen bij een herhaalde poging | ✅ | `idempotencyKey` |
| 45 | Status volgen: aanvraag, geaccepteerd, afgewezen | ✅ | `check_status` |
| 46 | Accepteren sluit de nachten, ook op Airbnb/Booking.com | ✅ | |
| 47 | Direct bevestigen binnen de regels van de eigenaar; anders nooit "geboekt" vóór bevestiging | ✅ | `booked`, `instantBooking` |
| 48 | Annuleren door de gast (via agent of statuspagina), nachten gaan weer open | ✅ | `cancel_request` |
| 49 | Kamer vasthouden tijdens een aanvraag, met automatische vervaltijd | ✅ | `holdUntil` |
| 50 | Echte reservering via de API van het boekingssysteem | 💡 | |

## F. Contact met de eigenaar

| # | Functie | Status | Tool / plek |
|---|---|---|---|
| 51 | Vraag aan de eigenaar stellen, bijv. over een onbekend gegeven | ✅ | `ask_host` |
| 52 | Antwoord van de eigenaar wordt een bevestigd gegeven voor alle volgende gasten | ✅ | |
| 53 | E-mail aan de eigenaar bij aanvraag of vraag | ✅ | SMTP |
| 54 | Antwoord per e-mail aan de gast (met toestemming) | ✅ | `replyEmail` |
| 55 | Bericht van de eigenaar zichtbaar voor de agent | ✅ | `check_status.hostMessage` |
| 56 | Eerdere antwoorden als veelgestelde vragen voor agents | ✅ | get_stay_details faq, answer_question |
| 57 | Pushmelding aan de eigenaar (telefoon) | ✅ | ntfy |
| 58 | Reactietijd en bevestigingsgraad van de eigenaar zichtbaar voor agents | ✅ | `host` |
| 59 | Herinneringen: eigenaar bij een open aanvraag, gast vóór aankomst | ✅ | planner |
| 60 | Alternatieve datum voorstellen bij afwijzen | 💡 | |

## G. Vertrouwen en veiligheid

| # | Functie | Status | Tool / plek |
|---|---|---|---|
| 61 | Sleutel per agentpartner | ✅ | |
| 62 | Limieten tegen misbruik (per IP en per agent) | ✅ | |
| 63 | Toestemming van de gast verplicht voor naam en e-mail | ✅ | `guestConsent` |
| 64 | Gastgegevens alleen bij de B&B; automatisch gewist | ✅ | bewaartermijn |
| 65 | Gids controleert licentie en eigendom van het adres | ✅ | |
| 66 | Ondertekende terugmelding van boekingen | ✅ | HMAC |
| 67 | Geen toegang tot interne netwerken via koppelingen | ✅ | |
| 68 | Rechten per agentsleutel (alleen lezen / ook handelen) | ✅ | `scopes` |
| 69 | Logboek van agentacties en boekingsdossier (prijs, voorwaarden, toestemming) | ✅ | `record`, dashboard |
| 70 | Ondertekende antwoorden, zodat agents de herkomst kunnen controleren | 💡 | |

## H. Koppeling en protocol

| # | Functie | Status | Tool / plek |
|---|---|---|---|
| 71 | MCP via Streamable HTTP | ✅ | `/mcp` |
| 72 | MCP via stdio (lokaal) | ✅ | |
| 73 | Eén gids-adres voor alle zelf-gehoste B&B's | ✅ | INNLI-gids |
| 74 | Alle 12 tools ook via de gids | ✅ | |
| 75 | Leesbare foutmeldingen in plaats van crashes | ✅ | |
| 76 | Instructies met eerlijkheidsregels voor agents | ✅ | |
| 77 | Strikte uitvoerschema's per tool | 🔜 | |
| 78 | Paspoort als MCP-resource | ✅ | innli://stay/{id} |
| 79 | REST-variant voor agents zonder MCP | 💡 | |
| 80 | Ondersteuning voor nieuwe agentprotocollen | 💡 | |

## I. Meting

| # | Functie | Status | Tool / plek |
|---|---|---|---|
| 81 | Van agentvraag tot bevestigde boeking | ✅ | dashboard |
| 82 | Uitgesplitst per agent | ✅ | |
| 83 | Crawlers apart, nooit als gast | ✅ | |
| 84 | Aanvragen via verblijfspagina en agent geteld | ✅ | |
| 85 | Boeking herleid naar de agent die de gast bracht | ✅ | `ref` |
| 86 | Welke eisen agents het vaakst stellen | ✅ | dashboard *Wat agents zoeken* |
| 87 | Gemiste kansen: afgevallen en waarom, met wat je moet bevestigen | ✅ | dashboard *Wat agents zoeken* |
| 88 | Rapport voor agentpartners | 💡 | |
| 89 | Maandrapport per e-mail aan de eigenaar | 💡 | |
| 90 | Vergelijking met soortgelijke B&B's (geanonimiseerd) | 💡 | |

## J. Vindbaarheid buiten de koppeling

| # | Functie | Status | Tool / plek |
|---|---|---|---|
| 91 | Verblijfspagina met schema.org | ✅ | `/verblijf/…` |
| 92 | robots.txt: zoek- en trainingscrawlers apart | ✅ | plugin, audit |
| 93 | Website-audit, inclusief tegenstrijdigheden tussen website en paspoort | ✅ | dashboard |
| 94 | WordPress-plugin met gegevens uit bevestigde feiten | ✅ | |
| 95 | Aanvraagformulier op de eigen website | ✅ | `[innli_request]` |
| 96 | Website inlezen naar een conceptpaspoort | ✅ | |
| 97 | Sitemap en robots.txt voor verblijfspagina's | ✅ | `/sitemap.xml` |
| 98 | Deelvoorbeeld voor links in chat-apps | ✅ | Open Graph |
| 99 | Waarschuwing bij een dubbele boeking met een ander kanaal | ✅ | planner, dashboard |
| 100 | Paspoort exporteren voor Google Bedrijfsprofiel | 💡 | |

---

# Deel 2: 200 nieuwe functies (#101–#300)

Toegevoegd in versie 0.6. **Stand deel 2: 127 gebouwd, 12 volgende stap, 61 later.** Ook hier: ✅ gebouwd en getest · 🔜 volgende stap · 💡 later.

Bewuste keuze: nieuwe functies zijn zoveel mogelijk **mogelijkheden binnen bestaande tools**, niet steeds nieuwe tools. Hoe meer tools een agent tegelijk ziet, hoe vaker hij de verkeerde kiest. Er kwam er één bij (`join_waitlist`, 13 in totaal); in 0.7 kwamen er drie bij (`answer_question`, `modify_request`, `report_data_issue`, 16 in totaal). Versie 1.1 voegt geen tools toe, alleen mogelijkheden binnen bestaande tools.

## K. Groepen en gezinnen

| # | Functie | Status | Waar |
|---|---|---|---|
| 101 | Groep te groot voor één kamer: combinatie van 2–3 kamers in één accommodatie | ✅ | `search_stays` → `rooms` |
| 102 | Gezelschap verdelen met minstens één volwassene per kamer | ✅ | `splitParty` |
| 103 | Minste kamers en minste lege bedden eerst | ✅ | |
| 104 | Eisen per kamer gecontroleerd met het deel van het gezelschap in die kamer | ✅ | |
| 105 | Offerte per kamer én totaal voor de groep | ✅ | `offer.rooms`, `offer.total` |
| 106 | Groep in één keer aanvragen | ✅ | `request_booking({ quoteIds })` |
| 107 | Alles of niets: de eigenaar bevestigt of weigert alle kamers samen | ✅ | |
| 108 | Mislukt één kamer bij het aanvragen, dan worden de andere vrijgegeven | ✅ | |
| 109 | Groep in één keer annuleren | ✅ | `cancel_request` |
| 110 | Eén e-mail aan eigenaar en gast voor de hele groep | ✅ | |
| 111 | Direct bevestigen voor groepen (als alle kamers binnen de regels vallen) | ✅ | |
| 112 | Groep als één kaart in het dashboard | ✅ | |
| 113 | Groepen ook via de INNLI-gids | ✅ | |
| 114 | Aanbetaling voor de hele groep opgeteld | ✅ | |
| 115 | Groepen over meerdere accommodaties in dezelfde plaats | 💡 | |
| 116 | Voorkeur voor kamers naast elkaar of op dezelfde verdieping | 🔜 | |
| 117 | Kinderbed of extra bed als optie per kamer | ✅ | extras (kinderbedje als optie) |
| 118 | Maximaal aantal kinderen per kamer | 💡 | |
| 119 | Verschillende aankomstdagen per kamer binnen één groep | 💡 | |
| 120 | Hele accommodatie afhuren (alle kamers) als één aanbod | 🔜 | |

## L. Data en flexibiliteit

| # | Functie | Status | Waar |
|---|---|---|---|
| 121 | Flexibele data in `search_stays`: eerste vrije periode per accommodatie | ✅ | `flexibleDates` |
| 122 | Flexibele data ook voor groepen | ✅ | |
| 123 | Begrensd aantal checks bij live boekingssystemen (max. 14 data) | ✅ | |
| 124 | Alternatieve data bij afwijzing of verlopen aanvraag | ✅ | `check_status.alternatives` |
| 125 | Alternatieven rond de gevraagde data (−7 tot +14 dagen) | ✅ | |
| 126 | Plekken in de buurt als zoekfilter ("bij het strand") | ✅ | `nearPlace` |
| 127 | Agent kan de taal van de omschrijving kiezen | ✅ | `language` |
| 128 | Welke talen beschikbaar zijn | ✅ | `availableLanguages` |
| 129 | Vakantiedagen/schoolvakanties als datumhint | 💡 | |
| 130 | "Lang weekend" (vr–ma) als vaste keuze | ✅ | flexibleDates.pattern long_weekend |
| 131 | Minimaal aantal nachten per aankomstdag (bijv. zaterdag) | ✅ | checkinDays + minNights per seizoen |
| 132 | Aankomst alleen op bepaalde dagen | ✅ | checkinDays |
| 133 | Inchecktijd op aanvraag (vroeg inchecken) | 💡 | |
| 134 | Laatste vrije kamers signaleren ("nog 1 kamer") | ✅ | check_availability fewLeft / roomsLeft |
| 135 | Beschikbaarheid in één antwoord voor meerdere maanden | 💡 | |
| 136 | Reistijd met OV vanaf een opgegeven plaats | 💡 | |
| 137 | Zoeken op route (stops onderweg, bijv. fietsvakantie) | 💡 | |
| 138 | Rustige periodes voorstellen (minder druk, lagere prijs) | 💡 | |
| 139 | Zoeken op bijzonder type verblijf (boomhut, molen, boerderij) | 🔜 | |
| 140 | Zoeken op prijs per nacht in plaats van totaal | ✅ | search_stays maxPricePerNight |

## M. Prijs en kortingen

| # | Functie | Status | Waar |
|---|---|---|---|
| 141 | Korting voor een lang verblijf | ✅ | `rates.discounts.longStay` |
| 142 | Last-minutekorting | ✅ | `lastMinute` |
| 143 | Vroegboekkorting | ✅ | `earlyBird` |
| 144 | Hoogste korting telt, kortingen stapelen niet | ✅ | |
| 145 | Korting als aparte, zichtbare regel in de offerte | ✅ | |
| 146 | Kortingen nooit op live tarieven (het boekingssysteem rekent zelf) | ✅ | |
| 147 | Kortingen zichtbaar voor agents per kamer | ✅ | `units[].discounts` |
| 148 | Kortingen instelbaar in het dashboard | ✅ | |
| 149 | Kortingscode van de eigenaar | ✅ | get_quote discountCode |
| 150 | Korting voor terugkerende gasten | 💡 | |
| 151 | Opties met prijs: fietsen, lunchpakket, laat uitchecken | ✅ | get_quote extras |
| 152 | Toeslag voor één nacht | ✅ | singleNightSupplement |
| 153 | Prijs per persoon in plaats van per kamer | 💡 | |
| 154 | Btw-specificatie op de offerte | 💡 | |
| 155 | Indicatieve prijs in andere valuta | 💡 | |
| 156 | Prijsgarantie: direct even goedkoop als op boekingssites | 💡 | |
| 157 | Prijsvergelijking per nacht over een periode | 🔜 | |
| 158 | Tarief geldig tot (prijsstop voor x uur) | ✅ | `validUntil` |
| 159 | Annuleringskosten berekenen volgens de voorwaarden | ✅ | cancellationCosts, cancellationCostIfCancelledNow |
| 160 | Toeristenbelasting per gemeente automatisch | 💡 | |

## N. Inhoud en vertrouwen

| # | Functie | Status | Waar |
|---|---|---|---|
| 161 | Foto's van de accommodatie met beschrijving | ✅ | `photos` |
| 162 | Foto's per kamer | ✅ | `units[].photos` |
| 163 | Foto's in schema.org | ✅ | |
| 164 | Alleen https-foto's | ✅ | |
| 165 | Plekken in de buurt met afstand en looptijd | ✅ | `pointsOfInterest` |
| 166 | Omschrijving in Engels, Duits, Frans | ✅ | `translations` |
| 167 | Veelgestelde vragen uit echte vragen van gasten | ✅ | `faq` |
| 168 | Eigenaar kiest per antwoord of het een FAQ wordt | ✅ | |
| 169 | Foto's, omgeving en vertalingen beheren in het dashboard | ✅ | |
| 170 | Verblijfspagina met fotogalerij en "In de buurt" | ✅ | |
| 171 | Foto's uploaden in het dashboard (nu: links) | ✅ | dashboard: Foto uploaden |
| 172 | Automatische alt-tekstcontrole (beschrijving ontbreekt of is vaag) | ✅ | /photos/check |
| 173 | Plattegrond of kameromschrijving per verdieping | 💡 | |
| 174 | Toegankelijkheidsfoto's (drempel, douche) gekoppeld aan feiten | 💡 | |
| 175 | Vertaling door AI als concept, eigenaar keurt goed | 💡 | |
| 176 | Duurzaamheidsgegevens (zonnepanelen, keurmerk) | ✅ | eco.* gegevens, eis eco_label/ev_charging |
| 177 | Huisregels als gestructureerde lijst | ✅ | rules.* gegevens, eis non_smoking |
| 178 | Geluidsinformatie per kamer zichtbaar op de pagina | 🔜 | |
| 179 | Controle op tegenstrijdige foto-onderschriften en feiten | 💡 | |
| 180 | Kwaliteitsscore van foto's en omschrijving | 💡 | |

## O. Wachtlijst en tweede kansen

| # | Functie | Status | Waar |
|---|---|---|---|
| 181 | Gast op de wachtlijst zetten | ✅ | `join_waitlist` |
| 182 | Alleen met toestemming van de gast | ✅ | `guestConsent` |
| 183 | Automatisch bericht zodra een kamer vrijkomt | ✅ | planner |
| 184 | Bericht met vooraf ingevulde aanvraaglink | ✅ | |
| 185 | Wachtlijststatus via `check_status` | ✅ | |
| 186 | Wachtlijst verloopt na de aankomstdatum; e-mailadres gewist | ✅ | |
| 187 | Maximaal 3 inschrijvingen per gast per accommodatie | ✅ | |
| 188 | Eigenaar ziet hoeveel gasten wachten | ✅ | dashboard |
| 189 | Wachtlijst ook via de gids | ✅ | |
| 190 | Wachtlijst voor elke kamer die past (niet één specifieke) | ✅ | |
| 191 | Wachtlijst met flexibele data | 🔜 | |
| 192 | Wachtlijst-gast krijgt voorrang (korte hold) | 💡 | |
| 193 | Alternatieve accommodaties voorstellen als het vol is | ✅ | check_availability alternatives |
| 194 | Herinnering aan de gast als een aanvraag bijna verloopt | 💡 | |
| 195 | Tweede keuze automatisch aanvragen als de eerste afwijst | 💡 | |
| 196 | Afgewezen aanvraag: reden in categorieën (vol, te kort, honden) | 🔜 | |
| 197 | Waarschuwing aan de agent als de eigenaar traag reageert | ✅ | `host.medianResponseHours` |
| 198 | Gasten informeren bij ziekte of overmacht van de eigenaar | 💡 | |
| 199 | Omboeken naar andere data (in plaats van annuleren) | ✅ | modify_request |
| 200 | Omboeken naar een andere kamer | ✅ | modify_request |

## P. Beoordelingen en bewijs

| # | Functie | Status | Waar |
|---|---|---|---|
| 201 | Beoordelingen alleen van bevestigde, afgeronde verblijven | ✅ | |
| 202 | Uitnodiging de dag na vertrek | ✅ | planner |
| 203 | Eén beoordeling per verblijf | ✅ | |
| 204 | Eigenaar kan reageren, niet verwijderen | ✅ | |
| 205 | Gemiddelde en recente beoordelingen voor agents | ✅ | `reviews` |
| 206 | Beoordelingen op de verblijfspagina, zonder naam | ✅ | |
| 207 | Ondertekend boekingsdossier (Ed25519) | ✅ | `signedRecord`, `signature` |
| 208 | Publieke sleutel van de installatie | ✅ | `/.well-known/innli.json` |
| 209 | Vaste volgorde (canonical JSON), dus controleerbaar | ✅ | |
| 210 | Geknoeid dossier valt door de controle | ✅ | test |
| 211 | Beoordeling per onderdeel (ontbijt, schoon, rust) | ✅ | beoordeling per onderdeel |
| 212 | Beoordelingen in meerdere talen | 💡 | |
| 213 | Beoordeling gekoppeld aan de bevestigde feiten ("tuin klopte") | 💡 | |
| 214 | Ondertekende beoordelingen | 💡 | |
| 215 | Bewijs van verblijf voor de gast (ondertekend) | 💡 | |
| 216 | Geschillen: dossier exporteren als PDF | 💡 | |
| 217 | Tijdstempel van een onafhankelijke partij | 💡 | |
| 218 | Feiten ondertekend (passport attestation) | 💡 | |
| 219 | Agents laten controleren of een dossier echt van de installatie komt | ✅ | `verifyRecord` |
| 220 | Gemiddelde beoordeling in zoekresultaten | ✅ | search_stays rating |

## Q. Protocollen en integratie

| # | Functie | Status | Waar |
|---|---|---|---|
| 221 | REST-API voor agents zonder MCP | ✅ | `/api/agent/v1/tools/{tool}` |
| 222 | OpenAPI 3.1-specificatie (bijv. voor ChatGPT GPT Actions) | ✅ | `/api/agent/v1/openapi.json` |
| 223 | REST met dezelfde sleutels, rechten en limieten als MCP | ✅ | |
| 224 | MCP-resources: paspoort per verblijf | ✅ | `innli://stay/{id}` |
| 225 | Lijst van alle verblijven als resources | ✅ | |
| 226 | MCP-prompt `plan_stay` met een eerlijk stappenplan | ✅ | |
| 227 | Eén handlertabel voor MCP en REST (één bron van waarheid) | ✅ | |
| 228 | Request-ID per verzoek, ook in foutmeldingen | ✅ | `x-request-id` |
| 229 | `Retry-After` bij overbelasting | ✅ | |
| 230 | Caching van openbare gegevens (ETag / 304) | ✅ | |
| 231 | Health-check met versie en aantallen | ✅ | `/health` |
| 232 | Uitvoerschema per tool | 🔜 | |
| 233 | OAuth 2.1 voor agentplatforms | ✅ | OAuth 2.1 (/.well-known/oauth-*) |
| 234 | Web Bot Auth: agents die zich cryptografisch identificeren | 💡 | |
| 235 | Webhooks voor agentplatforms bij statuswijziging | ✅ | request_booking callbackUrl |
| 236 | Server-sent events voor live status | 💡 | |
| 237 | MCP-elicitation: toestemming vragen via de agent-app | 💡 | |
| 238 | A2A of andere opkomende agentprotocollen | 💡 | |
| 239 | Koppeling met specifieke boekingssystemen | ✅ | Beds24 |
| 240 | iCal-export van bevestigde INNLI-boekingen voor de eigenaar | ✅ | boekingsagenda (iCal) |

## R. Eigenaar: meldingen en rapportage

| # | Functie | Status | Waar |
|---|---|---|---|
| 241 | Pushmelding op de telefoon bij een nieuwe aanvraag | ✅ | ntfy |
| 242 | Pushmelding bij een directe boeking | ✅ | |
| 243 | Pushmelding bij een vraag van een gast | ✅ | |
| 244 | Pushmelding bij een mogelijke dubbele boeking | ✅ | |
| 245 | Een mislukte pushmelding breekt nooit een boeking | ✅ | |
| 246 | Maandoverzicht per e-mail | ✅ | planner |
| 247 | Maandoverzicht maar één keer per maand | ✅ | |
| 248 | Rapport per agentpartner (van vraag tot boeking) | ✅ | `/api/admin/agents/report` |
| 249 | Export voor Google Bedrijfsprofiel (alleen bevestigde feiten) | ✅ | dashboard *Vindbaarheid* |
| 250 | Pushmeldingen instellen in het dashboard | ✅ | |
| 251 | WhatsApp-melding | 💡 | |
| 252 | Rustige uren (geen meldingen 's nachts) | 🔜 | |
| 253 | Accepteren of afwijzen vanuit de melding | 💡 | |
| 254 | Weekoverzicht in plaats van maand | 🔜 | |
| 255 | Bezettingsgraad per maand | ✅ | dashboard: Bezetting en omzet |
| 256 | Omzet per kanaal (agent, verblijfspagina, website) | ✅ | dashboard: Bezetting en omzet |
| 257 | Export van boekingen naar Excel/CSV | ✅ | CSV-export |
| 258 | Boekhoudexport | 💡 | |
| 259 | Meerdere gebruikers per accommodatie | 💡 | |
| 260 | Meertalig dashboard (EN/DE) | 💡 | |

## S. Prestaties en betrouwbaarheid

Gemeten met `npm run bench`, zie [prestaties.md](prestaties.md).

| # | Functie | Status | Waar |
|---|---|---|---|
| 261 | Opslag als append-only log: een gebeurtenis opslaan kost 0,02 ms in plaats van 1,3 s | ✅ | `src/store.ts` |
| 262 | Indexen op token, accommodatie en sleutel | ✅ | |
| 263 | Wijzigingen gebundeld en pas bij wegschrijven omgezet | ✅ | |
| 264 | Logs worden periodiek opgeschoond | ✅ | |
| 265 | Automatische migratie van de oude opslag | ✅ | |
| 266 | Bestand tegen een half weggeschreven regel na een crash | ✅ | |
| 267 | Zoeken over live boekingssystemen parallel (9× sneller) | ✅ | |
| 268 | Flexibele data parallel, met een limiet per eigenaar | ✅ | |
| 269 | Zoekinzichten als dagtotalen: opslag blijft begrensd | ✅ | |
| 270 | Benchmark met 300 accommodaties, 20.000 aanvragen, 200.000 gebeurtenissen | ✅ | `npm run bench` |
| 271 | Oude offertes en zoektotalen automatisch opgeruimd | ✅ | |
| 272 | Tijdlimiet op elke externe koppeling | ✅ | |
| 273 | Cache van agenda's (15 min), vers bij bevestigen | ✅ | |
| 274 | Database-opslag (Postgres/SQLite) voor grote installaties | 💡 | |
| 275 | Meerdere servers achter elkaar (horizontaal schalen) | 💡 | |
| 276 | Automatische back-up naar een tweede plek | ✅ | INNLI_BACKUP_DIR |
| 277 | Herstellen van een back-up in het dashboard | ✅ | Terugzetten in het dashboard |
| 278 | Prestatiemeting in productie | 🔜 | |
| 279 | Circuit breaker voor trage boekingssystemen | 🔜 | |
| 280 | Statuspagina voor agentpartners | 💡 | |

## T. Toekomst: betalen, identiteit, reserveren

| # | Functie | Status | Waar |
|---|---|---|---|
| 281 | Betalen via een agent (Google AP2 / OpenAI ACP) | 💡 | zodra stabiel |
| 282 | Aanbetaling via iDEAL-link van de eigenaar, automatisch gecontroleerd | 💡 | |
| 283 | Terugbetaling bij annulering volgens voorwaarden | 💡 | |
| 284 | Identiteit van de gast via de agent (geverifieerd e-mailadres) | 💡 | |
| 285 | Agent-identiteit via Visa/Mastercard-agentprotocollen | 💡 | |
| 286 | Echte reservering in het boekingssysteem via API | 💡 | |
| 287 | Online inchecken vóór aankomst | 💡 | |
| 288 | Digitale sleutel of sleutelkluiscode na betaling | 💡 | |
| 289 | Gastenregister (verplicht in NL) digitaal invullen | 💡 | |
| 290 | Toeristenbelasting-aangifte voorbereiden | 💡 | |
| 291 | Voice-agent (telefoon) op dezelfde gegevens | 💡 | |
| 292 | Chatwidget op de eigen website op dezelfde gegevens | 💡 | |
| 293 | Pakketten (verblijf + fietshuur + diner) met partners | 💡 | |
| 294 | Cadeaubonnen | 💡 | |
| 295 | Loyaliteit voor terugkerende gasten | 💡 | |
| 296 | Meertalige e-mails aan gasten | ✅ | e-mails in nl/en/de/fr |
| 297 | Gast kiest taal op de verblijfspagina | ✅ | ?lang= en taalkeuze |
| 298 | Gasten-app (PWA) met verblijfsinformatie | 💡 | |
| 299 | Samenwerking met lokale VVV/regiomarketing als agentpartner | 💡 | |
| 300 | Benchmark voor eigenaren t.o.v. vergelijkbare B&B's (anoniem) | 💡 | |
