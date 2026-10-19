# Knelpunten bij boeken via AI-agents (onderzoek oktober 2026)

Wat er in de praktijk misgaat bij boekingen via AI-agents en bij kleine accommodaties, en hoe INNLI 0.5 daarop antwoordt. Bronnen staan onderaan.

## Wat er misgaat

### Voor agents en gasten
1. **"Bevestigd" terwijl het nog niet zo is.** Een analyse uit juni 2026 liet zien dat AI-boekingsplatforms vaak een bevestigde status gaven aan boekingen die nog in behandeling waren. Ook kwamen ongeautoriseerde betalingen en annuleringen zonder toestemming van de gebruiker voor. Er ontstaat dan een aansprakelijkheidsvraag die niemand beantwoordt: hotel, platform en AI-leverancier wijzen naar elkaar. (Morgan Lewis)
2. **Verouderde of onvolledige gegevens.** Agents moeten de actuele beschikbaarheid zien voordat ze iets aanbevelen. Kunnen ze dat niet, of is de informatie onvolledig, dan valt de accommodatie buiten de keuze. Gegevens zijn het echte knelpunt. (XLR8, Hotel Tech Insight)
3. **Tegenstrijdige informatie.** Agents vergelijken bronnen. Zegt de website inchecken om 15:00 en een andere bron 14:00, dan daalt het vertrouwen. Bij tegenstrijdigheden kiest de agent de consistente bron, en dat is bijna altijd de OTA. (Quicktext, Hotel Tech Insight)
4. **Weinig zichtbaarheid.** Slechts 6% van de hotels verschijnt consequent in AI-aanbevelingen; 82% van wat AI aanbeveelt komt van OTA's en redactionele media. (Quicktext)
5. **Gasten vertrouwen het nog niet.** Reizigers geven aan nog niet klaar te zijn om een AI te laten boeken. (Skift)

### Voor kleine accommodaties
6. **Afhankelijkheid van OTA's.** Het aandeel van OTA's in boekingen van onafhankelijke hotels steeg naar 63,4% (2025), bij 15–22% commissie. AI-agents die geen live tarieven of boekingslink van het hotel vinden, sturen de gast naar Booking.com. (BookingWhizz, The Hotel Blueprint)
7. **Dubbele boekingen.** Als een agent beschikbaarheid noemt die niet klopt met de echte voorraad, ontstaan boekingsconflicten en verdwijnt het vertrouwen. (BookingWhizz)
8. **Geen tijd om te reageren.** Door personeelstekort blijven verzoeken liggen. (BookingWhizz)
9. **No-shows en betalingen.** Kapotte of ontbrekende betaallinks en onduidelijke aanbetalingen zijn een grote bron van klachten. Een aanbetaling van 30–50%, herinneringen vóór aankomst en duidelijke annuleringstermijnen verminderen no-shows. (Runnr.ai, SmartOrder)

### Techniek
10. **Productierijpe agentkoppelingen** vragen om rechten per partij (alleen zien wat toegestaan is), en om een duidelijk onderscheid tussen "gelukt" en "deels gelukt", zodat een agent een onvolledig antwoord niet als waarheid presenteert. (MCP-specificatie, Visiting Media)
11. **Betalen door agents** wordt gestandaardiseerd (Google AP2, OpenAI/Stripe ACP, Visa Trusted Agent Protocol, Mastercard Agent Pay), maar is nog volop in beweging.

## Wat INNLI 0.5 daaraan doet

| # | Knelpunt | Oplossing |
|---|---|---|
| 1 | Valse bevestigingen, annuleren zonder toestemming | Vaste statussen (`new` → `accepted` / `declined` / `expired` / `cancelled`), `booked: true` alleen bij een echte bevestiging, annuleren alleen met `guestConsent`, en een **boekingsdossier** per aanvraag: prijsregels, voorwaarden en toestemming zoals ze toen waren. Plus een **logboek** van alle agentacties. |
| 2, 7 | Verouderde beschikbaarheid, dubbele boekingen | **Kamer vasthouden** tijdens een aanvraag, zodat niemand anders hem krijgt. **Verse agenda-check** vlak voor bevestigen. **Waarschuwing bij dubbele boeking** als een ander kanaal dezelfde nacht verkoopt. |
| 3 | Tegenstrijdige gegevens | **Consistentiecheck**: website versus paspoort, per gegeven (inchecken, ontbijt, toeristenbelasting, schoonmaak, honden…). |
| 4 | Onzichtbaar door ontbrekende gegevens | **"Wat agents zoeken"**: welke eisen gasten stellen, en welke onbekende gegevens je kansen kostten, met wat je moet bevestigen. |
| 6 | OTA-afhankelijkheid | **Voordeel bij direct boeken** als paspoortgegeven dat agents noemen. Directe aanvragen en boekingen zonder commissie. |
| 8 | Geen tijd om te reageren | **Direct bevestigen** volgens regels van de eigenaar (dagen vooruit, maximaal aantal nachten). Aanvragen **vervallen automatisch**, met bericht aan de gast. **Herinnering** aan de eigenaar na 12 uur. **Reactietijd** zichtbaar voor agents. |
| 9 | No-shows, betalingen | **Aanbetaling** met de eigen betaalinstructies of betaallink van de eigenaar. INNLI verwerkt zelf geen geld. Plus een **bericht vóór aankomst** met inchecktijden en een herinnering aan een openstaande aanbetaling. |
| 10 | Productiekoppelingen | **Rechten per agentsleutel** (`read` / `act`), limieten per agent, leesbare foutmeldingen; agents krijgen bij elke status een expliciete `next` (volgende stap). |
| 11 | Agentbetalingen | Bewust nog niet: de gast betaalt de eigenaar rechtstreeks. Zodra AP2/ACP stabiel zijn, past een betaalstap op het boekingsdossier. |

## Bronnen
- [March 2026: The Month Agentic Travel Gets Real (OAG)](https://www.oag.com/blog/march-2026-the-month-agentic-travel-gets-real)
- [Travel Brands Are Building AI Agents for a Consumer That Doesn't Exist (Skift)](https://skift.com/2026/03/03/travel-brands-are-building-ai-agents-for-a-consumer-that-doesnt-exist/)
- [AI Agents Are Coming for Travel Booking in 2026 (XLR8)](https://tryxlr8.ai/news/ai-agents-travel-booking-data-infrastructure-2026)
- [Agentic AI Hotel Booking: 2026 Survival Guide for Independents (Hotel Tech Insight)](https://hoteltechinsight.com/2026/03/04/agentic-ai-hotel-booking-what-independent-hotels-need-to-know/)
- [AI concierge services: who is liable when a bot books the wrong vacation (Morgan Lewis)](https://www.morganlewis.com/blogs/sourcingatmorganlewis/2026/08/ai-concierge-services-who-is-liable-when-a-bot-books-the-wrong-vacation)
- [Hotel Distribution in 2026 (BookingWhizz)](https://bookingwhizz.com/en/blog/hotel-distribution-trends-2026)
- [AI Sends Hotel Guests to OTAs. Not to You (The Hotel Blueprint)](https://thehotelblueprint.com/hotel-market-intel/distribution/why-ai-is-making-ota-stronger/)
- [Data is King, Data Distribution is King Kong (Quicktext)](https://www.quicktext.im/blog/?p=26832)
- [No-Show Automation for Small Hotels (SmartOrder)](https://www.smartorder.ai/resources/blog/hotel-no-show-automation/)
- [Most common guest complaints in hotels (Runnr.ai)](https://runnr.ai/blog/most-common-guest-complaints-hotels)
- [ACP vs AP2: agentic commerce & payment standards](https://wetheflywheel.com/en/agentic-commerce/acp-vs-ap2/)
- [Agentic Payments in Travel (Facephi)](https://facephi.com/observatory/en/agentic-payments-travel-ap2/)
- [The MCP server that hospitality's AI future runs on (Visiting Media)](https://visitingmedia.com/blog/the-mcp-server-that-hospitalitys-ai-future-runs-on)
- [What's new in MCP 2025-06-18 (Cisco)](https://blogs.cisco.com/developer/whats-new-in-mcp-elicitation-structured-content-and-oauth-enhancements)
