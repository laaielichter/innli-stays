# Connector contract for booking systems

Nederlands: [nl/connector-contract.md](nl/connector-contract.md).

INNLI knows four kinds of availability sources. What an agent may offer depends on the source.

| Source | `certainty` | Price | What the guest gets |
|---|---|---|---|
| Live API (this contract) | `live` | live rates per night | direct booking link (if a template is set) |
| iCal calendars (several per room: Airbnb, Booking.com, Google Calendar…) | `synced` | base rate, indicative | availability request |
| Own room calendar in INNLI | `synced` | base rate, indicative | availability request |
| None | `none` | base rate, indicative | availability request |

Nights the owner closes in the room calendar are always unavailable, also with a live connection. With several iCal calendars, a night is taken as soon as one calendar has it taken. If one calendar cannot be read, the status is `unknown`.

Closed nights can be exported as iCal (`/api/public/calendar/<property>/<unit>.ics?key=…`, link in the dashboard) so that Airbnb or Booking.com can import them. Imported calendars are deliberately not exported again, to prevent loops between platforms.

## 1. Live availability

```
GET {baseUrl}/availability?unit={externalRef}&checkin=YYYY-MM-DD&checkout=YYYY-MM-DD&adults=2&children=0
Authorization: Bearer {apiKey}        (optional)
Accept: application/json
```

Response (within 8 seconds):

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

- `available` is required. If `nightly` does not give an amount for every night, INNLI uses the base rate and marks the price as indicative.
- Only `EUR` is supported.
- On an error or timeout the status becomes `unknown`. INNLI then makes no offer based on assumptions.

`src/demo/engine.ts` is a working reference implementation.

## 2. Booking link (deep link)

A template with placeholders, for example:

```
https://boeken.jouw-bnb.nl/?arrival={checkin}&departure={checkout}&adults={adults}&children={children}&room={unit}&ref={ref}
```

`{checkin} {checkout} {adults} {children} {dogs} {unit} {ref}`: `{unit}` is the room's `externalRef`. Without `{ref}`, INNLI adds `innli_ref=<ref>`. All values are URL-encoded.

## 3. Reporting bookings back

A booking only counts as confirmed when the accommodation reports it back.

```
POST {innli}/api/conversions
Content-Type: application/json
X-Innli-Signature: hex(HMAC-SHA256(webhookSecret, raw body))

{ "propertyId": "prop_…", "ref": "<innli_ref>", "bookingReference": "PMS-123", "amount": 251.60 }
```

- `webhookSecret` is in the dashboard under *Booking & details*.
- Duplicate reports (same `bookingReference`) are ignored: `{"recorded": false}`.
- Do not send any personal data of guests.

The WordPress plugin does this with `[innli_conversion]` or `do_action('innli_report_booking', $boekingsnummer, $bedrag)`.
