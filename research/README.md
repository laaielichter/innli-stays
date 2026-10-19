# INNLI als open onderzoeksproject

**Status (oktober 2026):** INNLI is een open onderzoeksproject onder de AGPL-3.0 (met een commerciële licentie voor wie die nodig heeft), gefinancierd uit eigen middelen van de maker. Er is geen externe financiering. Publieke fondsen zijn een optie voor later; verdienen ook, en alleen op manieren die het open karakter niet aantasten (zie [funding/overzicht.md](funding/overzicht.md)).

## De vraag

AI-agents gaan namens reizigers zoeken en boeken. Grote platforms zijn daar klaar voor. Kleine, onafhankelijke accommodaties zijn dat niet: ze worden onzichtbaar voor agents, of alleen bereikbaar via platforms die 15–22% commissie vragen.

**Hoofdvraag:** kan een open, zelf te hosten koppeling ervoor zorgen dat agents kleine accommodaties eerlijk, veilig en zuinig vinden en boeken, zonder tussenpartij die de gegevens of de klantrelatie bezit?

## Deelvragen, meetmethode en eerste resultaten

Alles is reproduceerbaar met de scripts in deze repo. Gastgegevens komen nooit in een onderzoeksdataset.

| # | Vraag | Hoe we meten | Eerste resultaat | Volgende stap |
|---|---|---|---|---|
| 1 | **Efficiëntie:** hoeveel context en tijd kost een agentkoppeling voor verblijven, en hoeveel kan eraf zonder informatieverlies? | `npm run measure`: tokens voor de tooldefinities per beurt en per antwoord, volledig tegenover compact | Core-profiel: 49% minder context per beurt. Compacte antwoorden: ~70% kleiner. Dezelfde feiten en statussen. | Meten met echte agentgesprekken (aantal stappen, kosten, fouten) bij drie agentplatforms |
| 2 | **Veiligheid:** kan een eenvoudige, uitlegbare filter indirecte prompt-injectie in teksten van eigenaren en gasten tegenhouden, zonder gewone gastvrije tekst te knippen? | `npm run research:injection` op [data/injection-cases.json](data/injection-cases.json): 70 gelabelde zinnen in vier talen | 30/30 aanvallen gevangen, 0/40 gewone zinnen geknipt. De evaluatie vond en verhielp een fout met markdown-links. | De set uitbreiden naar 500+ zinnen: echte advertentieteksten, herformuleringen en aanvallen van buitenaf. Vergelijken met een taalmodel als detector. |
| 3 | **Toestemming:** voorkomt een hash over de voorwaarden dat een agent boekt op voorwaarden die de gast niet zag? | Automatische tests waarin prijs, annulering of data veranderen tussen offerte en boeking | Elke wijziging stopt de aanvraag (`TERMS_CHANGED`) | Gebruikersonderzoek: begrijpen gasten de samenvatting, en kost de extra stap boekingen? |
| 4 | **Vraag en aanbod:** leiden anonieme verblijfswensen tot aanbiedingen en boekingen bij kleine accommodaties? | Pilot met 5–10 accommodaties: wens → aanbieding → aanvraag → boeking, en de tijd tot een aanbieding | Werkt end-to-end in tests, ook via de gids | Pilot draaien en de trechter publiceren |
| 5 | **Vertrouwen:** veranderen geverifieerde signalen (websitebewijs, ondertekend paspoort) welke verblijven agents kiezen? | Experiment: dezelfde zoekvraag aan meerdere agents/modellen, met en zonder vertrouwensblok | Nog niet gemeten | Experiment opzetten met 3+ modellen |
| 6 | **Vindbaarheid:** welke documenten (agent-card, MCP-serverkaart, `llms.txt`) halen agents en crawlers echt op? | Toegangslog per user-agent op de openbare gids | Nog niet gemeten | Telling toevoegen aan de gids, zonder IP-adressen te bewaren |

## Werkwijze

- **Open:** code (AGPL-3.0, agent-kit MIT), datasets en scripts staan in deze repo. Resultaten publiceren we hier, ook als ze tegenvallen.
- **Reproduceerbaar:** elk cijfer hierboven komt uit een script dat iedereen kan draaien.
- **Privacy:** onderzoek gebruikt alleen geaggregeerde tellingen of zelfgemaakte voorbeeldteksten, nooit gastgegevens.
- **Eerlijk over beperkingen:**
  - de injectieset is klein en zelf samengesteld;
  - de Beds24-koppeling is nog niet getest met een echt account;
  - de pilot met accommodaties moet nog beginnen.

## Achtergrond

- [../docs/agents-2.0.md](../docs/agents-2.0.md): de tien grootste knelpunten tussen agents en accommodaties, met bronnen.
- [../docs/onderzoek-knelpunten.md](../docs/onderzoek-knelpunten.md): eerder onderzoek naar boeken via agents.
- [funding/](funding/): fondsen, conceptaanvragen en het plan om later te verdienen.

## Citeren

Zie [../CITATION.cff](../CITATION.cff).

---

**English summary.** INNLI is an open research project on how AI agents can find and book small independent accommodations honestly, safely and efficiently, without an intermediary owning the data or the customer. It has six questions: efficiency, prompt-injection safety, consent, matchmaking through stay wishes, trust signals and discoverability. The first results are reproducible with `npm run measure` and `npm run research:injection`. It is licensed under the AGPL-3.0 (with a commercial licence on request) and self-funded by its maker; there is no external funding. Grants and monetisation are options for later, and will keep the project open.
