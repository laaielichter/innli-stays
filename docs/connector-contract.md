# Koppelcontract voor boekingssystemen

INNLI kent vier soorten beschikbaarheidsbronnen. Wat een agent mag aanbieden hangt ervan af.

| Bron | `certainty` | Prijs | Wat de gast krijgt |
|---|---|---|---|
| Live API (dit contract) | `live` | live tarieven per nacht | directe boekingslink (als een sjabloon is ingesteld) |
| iCal-agenda's (meerdere per kamer: Airbnb, Booking.com, Google Agenda…) | `synced` | basistarief, indicatief | beschikbaarheidsaanvraag |
| Eigen kamerkalender in INNLI | `synced` | basistarief, indicatief | beschikbaarheidsaanvraag |
| Geen | `none` | basistarief, indicatief | beschikbaarheidsaanvraag |

Nachten die de eigenaar in de kamerkalender sluit zijn altijd onbeschikbaar, ook bij een live koppeling. Bij meerdere iCal-agenda's is een nacht bezet zodra één agenda hem bezet heeft; kan één agenda niet gelezen worden, dan is de status `unknown`.

Gesloten nachten zijn als iCal te exporteren (`/api/public/calendar/<property>/<unit>.ics?key=…`, link in het dashboard) zodat Airbnb of Booking.com ze kan importeren. Geïmporteerde agenda's worden bewust niet opnieuw geëxporteerd, om lussen tussen platforms te voorkomen.

## 1. Live beschikbaarheid

```
GET {baseUrl}/availability?unit={externalRef}&checkin=YYYY-MM-DD&checkout=YYYY-MM-DD&adults=2&children=0
Authorization: Bearer {apiKey}        (optioneel)
Accept: application/json
```

Antwoord (binnen 8 seconden):

```json
{
  "available": true,
  "currency": "EUR",
  "nightly": [
    { "date": "2026-11-13", "amount": 138 },
    { "date": "2026-11-14", "amount": 138 }
  ]
}
```

- `available` is verplicht. Als `nightly` niet voor iedere nacht een bedrag geeft, gebruikt INNLI het basistarief en markeert de prijs als indicatief.
- Alleen `EUR` wordt ondersteund.
- Bij een fout of time-out wordt de status `unknown`; INNLI doet dan geen aanbod op basis van aannames.

`src/demo/engine.ts` is een werkende referentie-implementatie.

## 2. Boekingslink (deeplink)

Sjabloon met placeholders, bijvoorbeeld:

```
https://boeken.jouw-bnb.nl/?arrival={checkin}&departure={checkout}&adults={adults}&children={children}&room={unit}&ref={ref}
```

`{checkin} {checkout} {adults} {children} {dogs} {unit} {ref}` — `{unit}` is de `externalRef` van de kamer. Zonder `{ref}` voegt INNLI `innli_ref=<ref>` toe. Alle waarden zijn URL-gecodeerd.

## 3. Boekingen terugmelden

Een boeking telt alleen als bevestigd wanneer de accommodatie die terugmeldt.

```
POST {innli}/api/conversions
Content-Type: application/json
X-Innli-Signature: hex(HMAC-SHA256(webhookSecret, rauwe body))

{ "propertyId": "prop_…", "ref": "<innli_ref>", "bookingReference": "PMS-123", "amount": 251.60 }
```

- `webhookSecret` staat in het dashboard onder *Boeking & gegevens*.
- Dubbele meldingen (zelfde `bookingReference`) worden genegeerd: `{"recorded": false}`.
- Stuur geen persoonsgegevens van gasten mee.

De WordPress-plugin doet dit met `[innli_conversion]` of `do_action('innli_report_booking', $boekingsnummer, $bedrag)`.
