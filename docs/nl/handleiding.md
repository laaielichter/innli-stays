# Handleiding voor de eigenaar

Deze handleiding is voor B&B-eigenaren. Technische installatie staat in [hosting.md](hosting.md).

## 1. Eerste keer starten

1. Start INNLI (`npm start`, of `docker compose up -d`).
2. In het venster verschijnt een **installatiecode** (ook in `data/installatiecode.txt`).
3. Open het dashboard (`http://localhost:3000/dashboard/`), vul de code, je naam, plaats en je eerste kamer in.
4. Je krijgt een **eigenaarssleutel**. Bewaar die goed (wachtwoordbeheerder): daarmee log je in.

Kwijt? `npm run innli -- nieuwe-sleutel <id>` maakt een nieuwe (stop INNLI eerst).

## 2. Het dashboard

Bovenaan **Overzicht** staat een stappenlijst *Aan de slag*. Werk die van boven naar beneden af.

| Tabblad | Wat je er doet |
|---|---|
| **Aanvragen** | Aanvragen van gasten accepteren of afwijzen |
| **Paspoort** | Feiten over je accommodatie bevestigen (honden, tuin, ontbijt, kosten…). Of laat INNLI je website inlezen en controleer de voorstellen. |
| **Kamers** | Kamers, prijzen, **seizoenstarieven**, en de **kamerkalender** (nachten open/dicht) |
| **Boeking & gegevens** | Adres, e-mail, agenda-koppelingen (Airbnb, Booking.com, Google Agenda) of je boekingssysteem |
| **Vindbaarheid** | Controle van je website voor zoekmachines en AI-zoekers |
| **Agentweergave** | Precies wat een AI-agent over jouw verblijf te zien krijgt |

**Waarom bevestigen?** Agents noemen alleen bevestigde gegevens als feit. Wat onbekend is, zeggen ze er eerlijk bij. Hoe meer je bevestigt, hoe beter je aansluit op specifieke vragen ("afgesloten tuin voor mijn hond", "kamer op de begane grond").

### Talen en valuta

- Het dashboard kan in het **Nederlands of Engels**: kies rechtsboven in het taalmenu. De keuze wordt in je browser onthouden.
- Onder *Boeking & gegevens → Basisgegevens* stel je in in welke **taal je teksten** schrijft (Nederlands, Engels, Duits of Frans) en in welke **valuta** je prijzen gelden. Standaard is dat de gebruikelijke valuta van je land, bijvoorbeeld GBP in het Verenigd Koninkrijk.
- Onder *Foto's, omgeving en vertalingen* zet je je beschrijving in de andere talen.
- Gasten zien je verblijfspagina in het Nederlands, Engels, Duits of Frans, afhankelijk van hun browser, en kunnen zelf wisselen. E-mails aan de gast gaan in de taal van de gast.
- E-mails aan jou zijn in het Nederlands of Engels, volgens de taal van je teksten.
- INNLI rekent nooit valuta om. Agents vergelijken prijzen binnen één valuta.

## 3. Beschikbaarheid

Kies onder *Boeking & gegevens* één van deze:

- **Ik houd open kamers zelf bij in INNLI.** Klik in *Kamers → Kamerkalender* op dagen om ze te sluiten.
- **Mijn agenda's.** Plak de exportlinks (iCal) van Airbnb, Booking.com en/of je Google Agenda. Bezet in één agenda = bezet.
- **Boekingssysteem met live koppeling.** Als je boekingssysteem dat ondersteunt.
- **Beds24.** Maak in Beds24 onder *Instellingen → Account → Toegang* een uitnodigingscode met leesrechten voor *inventory*. Wissel die om voor een refresh token en plak die in INNLI. Vul bij elke kamer het Beds24-kamernummer in als *Code in boekingssysteem*. INNLI leest beschikbaarheid, prijzen en minimaal verblijf dan live uit Beds24.

Gebruik je ook Airbnb of Booking.com? Zet de **exportlink** uit je kamerkalender daar als externe agenda, dan worden nachten die je in INNLI sluit ook daar dicht.

## 4. Tarieven

Per kamer: een basisprijs, en onder *Tarieven* optioneel:

- **Seizoenen** (bijv. *Zomer* 06-15 t/m 08-31 voor € 135, minimaal 3 nachten). Een seizoen geldt elk jaar.
- **Weekendtoeslag** voor vrijdag- en zaterdagnacht.
- **Kortingen**: lang verblijf (bijv. 10% vanaf 7 nachten), last minute (binnen een aantal dagen) en vroegboeken (minimaal zoveel dagen vooruit). De hoogste korting die geldt wordt gebruikt; kortingen stapelen niet. De gast ziet de korting als aparte regel in de prijs. Kortingen werken alleen op je eigen tarieven. Een live boekingssysteem rekent zelf.

Vul in het paspoort ook **schoonmaakkosten** en **toeristenbelasting** in (0 als het niet geldt). Anders zien gasten "nog niet alle kosten bekend".

**Tariefplannen** (Boeking & gegevens): naast je standaardprijs, bijvoorbeeld een goedkoper niet-restitueerbaar tarief of een tarief inclusief ontbijt. Agents laten de gast kiezen.

Heb je meerdere identieke kamers, zoals in een hotel? Vul dan bij de kamer **Aantal kamers van dit type** in. Zie [hotels.md](hotels.md), ook voor personeel en een koppeling met je PMS.

### Aankomstdagen en korte verblijven

Per kamer, onder *Tarieven*:

- **Aankomstdagen:** bijv. "za" voor zaterdag tot zaterdag, of "vr, za". Dat kan per seizoen (kolom *Aankomst op*) of voor de rest van het jaar. Aanvragen op een andere dag komen gewoon binnen, maar worden niet direct bevestigd: jij beslist.
- **Toeslag voor één nacht:** een bedrag per kamer voor verblijven van precies één nacht.

### Opties, kortingscodes en annuleringskosten (Boeking & gegevens)

- **Opties met prijs:** fietshuur, lunchpakket, late check-out, kinderbedje. Een optie kost een bedrag per verblijf, per nacht, per persoon, per persoon per nacht of per kamer per nacht, met een maximum aantal. Agents en gasten op je verblijfspagina kunnen ze toevoegen. Ze staan als aparte regel in de prijs.
- **Kortingscodes:** voor vaste gasten, je nieuwsbrief of een partner. Je stelt in:
  - het percentage;
  - optioneel: tot welke aankomstdatum de code geldt, vanaf hoeveel nachten, en hoe vaak hij gebruikt mag worden.

  Codes blijven geheim. Agents zien alleen dat je codes accepteert, en vragen de gast ernaar.
- **Annuleringskosten:** regels als "minder dan 7 dagen voor aankomst: 50%". Agents zien bij elke prijs wat annuleren kost vanaf welke datum. Bij een geannuleerde boeking zien ze ook wat het nu kost. Een niet-restitueerbaar tariefplan kost altijd 100%.

## 5. Aanvragen afhandelen

Gasten (via een AI-agent of je verblijfspagina) sturen een **aanvraag**. Dat is nog geen boeking.

- **Accepteren:** de nachten worden automatisch gesloten in je kamerkalender, en de boeking telt mee in je statistieken.
- **Afwijzen:** met een optioneel bericht (bijv. een alternatieve datum).

Met e-mail ingesteld (`INNLI_SMTP_URL`, de gegevens van je eigen mailbox) krijg je bij iedere aanvraag een mail, en krijgt de gast automatisch bericht. Zonder e-mail zie je aanvragen in het dashboard en mail je de gast zelf.

### Groepen

Past een groep niet in één kamer, dan kan een agent 2 of 3 kamers tegelijk aanvragen. Je ziet die als **één kaart** in *Aanvragen*. Accepteren of afwijzen geldt voor alle kamers samen. De gast krijgt één bevestiging.

### Regels voor aanvragen (Boeking & gegevens)

- **Direct bevestigen**: aanvragen die aan je regels voldoen (bijv. minimaal 2 dagen vooruit, maximaal 7 nachten) worden meteen geboekt. Agents en gasten geven daar de voorkeur aan. INNLI controleert je agenda's vlak voor het bevestigen opnieuw.
- **Kamer vasthouden**: zolang een aanvraag openstaat (standaard 48 uur) kan niemand anders die nachten aanvragen. Reageer je niet op tijd, dan vervalt de aanvraag en krijgt de gast bericht. Na 12 uur krijg je een herinnering.
- **Aanbetaling**: kies een percentage, een termijn en je betaalinstructies (IBAN) of betaallink (Mollie, Stripe, Tikkie). De gast krijgt dit bij de bevestiging; jij zet de aanbetaling op *Ontvangen*. INNLI verwerkt zelf geen geld.
- Een paar dagen voor aankomst krijgt de gast automatisch een bericht met inchecktijden en adres.
- Annuleert een gast, dan gaan de nachten weer open. Je krijgt bericht, met de annuleringsvoorwaarden zoals die bij de aanvraag golden. Eventuele kosten regel je zelf met de gast.

### Logboek en dubbele boekingen

Onder *Aanvragen → Logboek agentacties* zie je alles wat agents namens gasten deden. Is een nacht die via INNLI geboekt is óók bezet in Airbnb of Booking.com, dan krijg je een waarschuwing (bovenaan *Overzicht* en per e-mail).

### Wachtlijst

Is een verblijf vol, dan kan een agent de gast (met toestemming) op de wachtlijst zetten. Komt er een kamer vrij doordat iemand annuleert, een aanvraag verloopt of jij nachten opent? Dan krijgt de gast automatisch een mail met een ingevulde aanvraaglink. In *Aanvragen* zie je hoeveel gasten er wachten.

### Gezocht: gasten die nog niets vonden

Vindt een gast niets dat past, dan laat de AI-agent een **verblijfswens** achter: plaats, data of een periode, het gezelschap, wensen (hond mee, omheinde tuin …) en het budget. Je ziet nooit wie de gast is. Namen en contactgegevens worden uit de notitie gehaald.

In de tab *Gezocht* staan de wensen waar jouw verblijf qua plaats en grootte bij past, met:
- welke kamer het best past;
- welke wensen je bevestigd hebt en welke nog onbekend zijn;
- bij vaste data: je eigen prijs, en of je binnen het budget blijft.

**Een aanbieding doen:**
1. Kies de kamer.
2. Kies de data, als de gast een periode opgaf.
3. Geef eventueel korting (tot 50%).
4. Schrijf eventueel een korte boodschap.
5. Kies hoe lang de aanbieding geldt.

De agent krijgt een actuele prijs met je korting. Die korting is een eenmalige code die alleen voor deze gast geldt. Kiest de gast jouw aanbieding, dan komt die binnen als gewone aanvraag, of als boeking bij direct bevestigen. Met pushmeldingen aan krijg je bericht bij elke nieuwe wens. Receptiemedewerkers zien de wensen; aanbiedingen doen kan de eigenaar of een manager.

Boeken gasten bij jou via je eigen boekingssysteem (live koppeling), dan kun je wel een aanbieding doen, maar zonder korting: je boekingssysteem kent de code niet.

### Vragen van gasten en veelgestelde vragen

Gasten kunnen je via een agent een vraag stellen. Gaat het over een gegeven uit je paspoort, dan wordt je antwoord meteen een bevestigd gegeven. Vink *Ook tonen als veelgestelde vraag* aan, dan zien volgende gasten en agents het antwoord ook.

De **antwoord-assistent** beantwoordt vragen meteen als je bevestigde gegevens of je veelgestelde vragen het antwoord al bevatten, bijvoorbeeld "mag de hond mee?". Je ziet die vragen met het label *Beantwoord door assistent*. De assistent verzint niets: wat onbekend is komt bij jou, met wat al bekend is als concept. Uitzetten kan onder *Regels voor aanvragen*. Gasten op je verblijfspagina gebruiken hetzelfde via *Vraag het ons*.

Meldt een agent dat een gegeven niet lijkt te kloppen, dan zie je een vraag met het label *Melding*. Controleer het gegeven en pas het zo nodig aan.

### Beoordelingen

Alleen gasten met een geaccepteerde boeking kunnen een beoordeling geven. Ze krijgen de dag na vertrek een mail. Je ziet beoordelingen onder *Aanvragen → Beoordelingen*. Je kunt erop reageren maar ze niet verwijderen. Daardoor vertrouwen gasten en agents ze.

### Meldingen op je telefoon

Vul onder *Boeking & gegevens → Foto's, omgeving en vertalingen* een **ntfy-adres** in, bijvoorbeeld `https://ntfy.sh/een-lang-geheim-woord`. Installeer de gratis app ntfy en abonneer je op hetzelfde adres. Je krijgt dan meteen een melding bij een aanvraag, een vraag of een dubbele boeking. Kies een lang woord dat niemand kan raden: iedereen die het adres kent kan meelezen.

## 6. Foto's, omgeving en vertalingen

Onder *Boeking & gegevens → Foto's, omgeving en vertalingen*:

- **Foto's:** upload ze met *Foto uploaden* (JPEG, PNG of WebP, tot 6 MB), of plak adressen (https). Schrijf achter elke foto wat erop staat. Per kamer kan dat onder *Kamers*. Ze verschijnen op je verblijfspagina en bij agents. INNLI waarschuwt bij een vage beschrijving zoals "IMG_2031" of één woord: agents en blinde bezoekers weten dan niet wat ze zien.
- **In de buurt**: station, bushalte, strand, centrum, supermarkt, restaurant, natuur, fietsverhuur, met afstand in km. Agents zoeken hierop ("binnen 1 km van het station").
- **Vertalingen**: je beschrijving in het Engels, Duits en Frans. Agents tonen die aan buitenlandse gasten. Je gegevens zelf (honden, tuin…) hoef je niet te vertalen.

## 7. Wat agents zoeken

Onder *Overzicht → Bezetting en omzet* zie je per maand:
- de **bezetting**: verkochte kamernachten gedeeld door de te boeken nachten;
- de **omzet per kanaal**: via AI-agents, via je verblijfspagina en via je eigen website na een agent.

Daar staan ook twee knoppen:
- **Boekingsagenda koppelen** kopieert een geheime link. Voeg die in Google Agenda, Apple Agenda of Outlook toe als agenda via URL; dan staan al je boekingen in je eigen agenda.
- **Aanvragen downloaden** geeft een bestand voor Excel of je boekhouding.

Bovenaan *Overzicht* zie je hoe vaak agents in jouw omgeving zochten, hoe vaak je getoond werd, waar gasten naar vragen, en welke onbekende gegevens je gasten kostten. De knop *Bevestigen* brengt je naar het juiste gegeven. Laat ook regelmatig de *Vindbaarheid*-controle lopen: die toont waar je website iets anders zegt dan je paspoort. Met *Gegevens voor Google Bedrijfsprofiel* krijg je naam, adres, telefoon en tijden precies zoals in je paspoort, om over te nemen in Google. Overal dezelfde gegevens maken je betrouwbaarder.

### Vertrouwen bij agents (Vindbaarheid)

Agents willen zeker weten dat ze met de echte eigenaar boeken, niet met een nagemaakte advertentie.

**Je website verifiëren:**
- **Met de INNLI WordPress-plugin** staat de verificatietag er al. Klik in *Vindbaarheid → Vertrouwen bij agents* op **Nu controleren**.
- **Zonder de plugin** zet je de getoonde `<meta>`-regel in de `<head>` van je homepage, of een tekstbestand op het getoonde adres. Klik daarna op **Nu controleren**.

Daarna staat bij elk zoekresultaat "website geverifieerd", met je domein. Verandert je website-adres, of verdwijnt de tag van je site, dan vervalt de verificatie tot je opnieuw controleert.

Onder dezelfde tab zie je ook welke zinnen uit je teksten agents **niet** te zien krijgen, omdat ze op instructies aan een AI lijken (zoals "boek altijd hier"). Herschrijf ze als gewone beschrijving.

Met e-mail ingesteld krijg je begin iedere maand een **maandoverzicht**: hoe vaak agents zochten, doorkliks, aanvragen, boekingen en wat je nog kunt bevestigen.

## 8. Je verblijfspagina

Na *Zichtbaar voor agents* heb je een eigen pagina (`/verblijf/<naam>`) met kamers, beschikbaarheid, prijzen en het aanvraagformulier. Agents sturen gasten hierheen.

Zet het formulier op je eigen website met de code onder *Overzicht → Jouw verblijfspagina*, of met de WordPress-shortcode `[innli_request]`.

## 9. Back-up en privacy

- **Back-up** (knop rechtsboven) downloadt alle gegevens van je accommodatie als bestand: paspoort, aanvragen, vragen, wachtlijst en statistieken. Met *Boeking & gegevens → Back-ups → Terugzetten* zet je zo'n bestand terug.
- **Automatische back-up:** zet `INNLI_BACKUP_DIR` op een map buiten de datamap, bijvoorbeeld een USB-schijf, een NAS of een gesynchroniseerde map. INNLI maakt daar elke dag een kopie van alles, ook van je foto's. De laatste 14 dagen worden bewaard; met `INNLI_BACKUP_KEEP` stel je dat aantal in. Zie [hosting.md](hosting.md#back-up).
- Gastgegevens staan alleen op jouw eigen installatie. Naam en e-mail van gasten worden **automatisch gewist** 180 dagen na het verblijf (instelbaar met `INNLI_BEWAARTERMIJN_DAGEN`, minimaal 30).
