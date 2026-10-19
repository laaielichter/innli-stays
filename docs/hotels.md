# INNLI voor hotels en drukke accommodaties

INNLI begon bij B&B's, maar werkt net zo goed voor een hotel met honderden kamers. Deze handleiding legt uit wat er voor hotels bij komt en hoe je het instelt. Alles werkt ook voor een B&B: wie het niet nodig heeft, merkt er niets van.

Probeer het met het voorbeeldhotel: `npm run demo` start INNLI met **Hotel Het Spaarne** (48 kamers in vier kamertypes, twee tariefplannen, direct boeken en een FAQ). De sleutels staan in `data/demo-credentials.json`.

## Kamertypes met meerdere kamers

Een hotel verkoopt geen losse kamers maar kamertypes: "Standaard tweepersoonskamer, 24 kamers".

- **Instellen:** Dashboard → *Kamers* → **Aantal kamers van dit type**.
- **Beschikbaarheid** telt per nacht hoeveel kamers bezet zijn: bevestigde boekingen, lopende aanvragen en tijdelijke reserveringen van agents. Zijn ze allemaal bezet, dan is het type uitverkocht.
- **Kamerkalender:** het kleine getal per dag is het aantal vrije kamers. Klik op een dag om de verkoop voor die nacht te stoppen (stop-sell).
- **Groepen:** zes personen krijgen bijvoorbeeld 3 × Standaard. Agents zien `roomsOfThisType` en `roomsLeft` en vragen met `rooms` om meerdere kamers tegelijk (tot 10 per boeking).
- **Agenda's (iCal):** bij een type met meerdere kamers telt elke boeking in de feed als één bezette kamer.

## Tariefplannen

Naast je standaardprijs kun je tot tien tariefplannen maken (Dashboard → *Boeking & gegevens* → *Tariefplannen*). Een plan heeft:

- een **prijsverschil** in procenten, bijvoorbeeld −12% voor niet-restitueerbaar of +14% inclusief ontbijt;
- **restitueerbaar ja/nee**, met eigen annuleringsvoorwaarden;
- optioneel **ontbijt inbegrepen**.

Agents krijgen bij elke prijs de lijst `ratePlanOptions`: hetzelfde verblijf in elk plan, met totaalprijs en voorwaarden. De gast kiest; de agent vraagt de prijs op met `ratePlanId`. Op de verblijfspagina kiest de gast het tarief in het formulier. Het gekozen plan en de voorwaarden komen in het ondertekende boekingsdossier.

## De antwoord-assistent

Drukke accommodaties krijgen veel dezelfde vragen. De antwoord-assistent beantwoordt ze meteen, in het Nederlands, Engels, Duits of Frans. Mag de hond mee? Is er parkeerplaats? Is er een lift?

- **Waar de antwoorden vandaan komen:** alleen uit gegevens die je zelf hebt bevestigd, en uit vragen die je eerder beantwoordde en als veelgestelde vraag publiceerde. Er zit geen taalmodel in en er wordt niets verzonnen.
- **Wat niet bekend is**, komt gewoon bij jou terecht. Kan de assistent een deel beantwoorden, dan staat dat deel al klaar als concept onder de vraag. Jij vult de rest aan.
- **Agents** gebruiken de tool `answer_question`, of krijgen bij `ask_host` meteen antwoord als de assistent het weet.
- **Gasten** gebruiken het vak *Vraag het ons* op de verblijfspagina.
- **Uitzetten:** Dashboard → *Regels voor aanvragen* → *Antwoord-assistent*.

## Wijzigen in plaats van annuleren

Wil een gast andere data, een andere kamer of meer kamers, dan gebruikt de agent `modify_request`.

- **Lopende aanvraag:** die wordt meteen vervangen.
- **Bevestigde boeking:** die blijft gewoon staan tot jij (of direct boeken) de wijziging bevestigt. Pas dan wordt de oude boeking vervangen. De gast zit dus nooit zonder kamer.

In het dashboard staat bij de nieuwe aanvraag het label *Wijziging*.

## Kamers kort vasthouden

Met `get_quote({ hold: true })` houdt een agent de kamers 15 minuten vast terwijl de gast beslist. Stuurt de agent binnen die tijd een aanvraag, dan gaat de reservering daarin over. Zo verkoopt een druk hotel niet twee keer de laatste kamer.

## Personeel

Geef iedereen een eigen sleutel (Dashboard → *Boeking & gegevens* → *Personeel*):

| Rol | Mag |
|---|---|
| **Receptie** | Aanvragen accepteren en afwijzen, vragen beantwoorden, kamerkalender (stop-sell), beoordelingen, overzicht. Ziet geen geheimen. |
| **Manager** | Alles van de receptie, plus kamers, prijzen, tariefplannen, gegevens en de webhook. |
| **Eigenaar** | Alles, plus sleutels voor personeel, licentie en back-ups. |

Bij elke beslissing staat wie die nam ("afgehandeld door Noor"). Vertrekt iemand, dan trek je de sleutel in; die werkt dan meteen niet meer.

## Koppeling met je PMS of channel manager (webhook)

INNLI stuurt elke gebeurtenis meteen naar een adres van jou: een PMS, een channel manager, of Zapier/Make. Stel het in onder Dashboard → *Boeking & gegevens* → *Koppeling met je eigen systeem*.

| Gebeurtenis | Wanneer |
|---|---|
| `request.created` | Nieuwe aanvraag, wacht op jou |
| `booking.confirmed` | Bevestigd, door jou of direct |
| `request.declined` | Afgewezen |
| `request.expired` | Niet op tijd beantwoord |
| `request.cancelled` | Aanvraag ingetrokken of vervangen door een wijziging |
| `booking.cancelled` | Bevestigde boeking geannuleerd of vervangen door een wijziging |

Een bericht ziet er zo uit:

```json
{
  "id": "evt_…",
  "type": "booking.confirmed",
  "createdAt": "2026-10-06T14:01:00.000Z",
  "propertyId": "prop_spaarne",
  "data": {
    "requestId": "req_…", "status": "accepted", "replacesRequestId": null,
    "unitId": "standaard", "unitRef": "STD", "rooms": 3, "ratePlanId": "non-refundable",
    "checkin": "2026-10-26", "checkout": "2026-10-28",
    "guests": { "adults": 6, "children": 0, "dogs": 0 },
    "guest": { "name": "…", "email": "…", "phone": "…" },
    "total": 699.72, "currency": "EUR", "priceLines": [ … ], "payment": null
  }
}
```

**Controleren dat het echt van INNLI komt:**

1. Lees de header: `x-innli-signature: t=<unix-tijd>,v1=<hex>`.
2. Bereken HMAC-SHA256 over `<t>.<ruwe body>` met het geheim uit het dashboard.
3. Vergelijk de uitkomst met `v1`. Weiger berichten met een `t` die meer dan 5 minuten oud is.

`unitRef` is de *Code in boekingssysteem* van het kamertype; daarmee koppel je aan je PMS.

**Afleveren:** INNLI wacht maximaal 10 seconden op antwoord. Bij een fout probeert INNLI het na 5 seconden en na 1 minuut opnieuw. De laatste aflevering of fout staat in het dashboard. Een kapotte webhook houdt nooit een boeking tegen. Met de knop *Testbericht sturen* controleer je de koppeling.

## Grote hotels in de gids

De openbare INNLI-gids neemt elk verblijf gratis op, ook hotels met honderden kamers.

## Snelheid

Gemeten met `npm run bench`, voor een hotel van 300 kamers met 10.000 boekingen (zie [prestaties.md](prestaties.md)):

| Wat | Tijd |
|---|---:|
| Beschikbaarheid | ~1 ms |
| Prijs voor 3 kamers met tariefplan | ~1 ms |
| Kamerkalender van 120 dagen | ~2,5 ms |
