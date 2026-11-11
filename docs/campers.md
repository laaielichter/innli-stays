# Camper rental

INNLI also works for a company that rents out motorhomes and campervans. A camper is booked like a room: dates, a party and a price. A rental company has rules a B&B never needs: who may drive, how far, and what happens with the deposit. This page says how INNLI handles them.

Try it: start INNLI with the sample data (`npm run demo`). It includes *Veluwe Campers*, a made-up company with three vehicles.

## For the rental company

Choose **Camper rental** as the type of your property. Each vehicle (or each group of identical vehicles) is one unit, with its own price per night and calendar.

The dashboard then asks rental questions instead of questions about rooms and breakfast:

| About the rental | About each vehicle |
|---|---|
| Pick-up address, pick-up from, return by | Vehicle type, year, length and height |
| Minimum driver age, years with a licence | Seats with a seat belt |
| Security deposit | Driving licence needed (B, C1 or C) |
| Insurance included, deductible per claim | Transmission and fuel |
| Kilometres: unlimited, or included per day and the price per extra kilometre | Toilet, shower, kitchen, heating |
| Abroad allowed, and in which countries | Suitable for winter, bike rack, awning |
| Fuel policy | |

As everywhere in INNLI, each answer has a status. A rule you did not state is *unknown*, not absent: an agent is told to ask you, and may not assume there is no age limit.

What stays the same: seasons and discounts, paid options (an extra driver, bikes), cancellation rules, booking requests or instant booking, the signed booking record, and the cleaning fee. Tourist tax is left out of the price: a camper pays it where it parks for the night.

## For agents

Campers and places to stay are never mixed in one search.

1. **Search**: `search_stays({ kind: "camper", checkin, checkout, guests, requirements })`. Nights are rental days. Requirements for campers: `automatic_transmission`, `car_licence_ok`, `toilet_on_board`, `shower_on_board`, `winter_ready`, `unlimited_km`, `bike_rack`, `travel_abroad`. The party must fit the seats with a seat belt.
2. **Ask the guest who drives**, then **quote**: `get_quote({ ..., driver: { age, licenceCategory, licenceYears } })`.
3. **Read `rental` in the quote**:

```json
{
  "kilometres": { "unlimited": false, "includedPerDay": 150, "includedForThisRental": 750, "pricePerExtraKm": 0.3 },
  "securityDeposit": 1000,
  "insurance": { "included": true, "deductiblePerClaim": 1000 },
  "driverRules": { "minAge": 23, "minLicenceYears": 2 },
  "driver": { "eligible": true, "reasons": [], "needs": [] },
  "pickup": { "location": "Laan van de Dierenriem 12, Apeldoorn", "from": "14:00" },
  "return": { "until": "10:00" },
  "abroad": { "allowed": true, "countries": ["NL", "BE", "DE", "FR", "LU", "DK"] },
  "notConfirmed": [],
  "unknown": []
}
```

- `driver.eligible` is `true`, `false` (with `reasons`) or `null` (with `needs`: what to ask the guest or the company first).
- The **deposit is not part of the total**. It is paid at pick-up and returned afterwards. Say so to the guest.
- `unknown` lists rental rules the company did not state. Do not fill them in.

4. **Consent**: `consent.summary` includes the kilometres, the deposit and the insurance. If the company changes one of them after the guest agreed, `request_booking` answers `TERMS_CHANGED`.
5. **Request**: `request_booking` as for a stay. It is refused with `DRIVER_NOT_ELIGIBLE` when the driver or the party breaks a rule, and with `INVALID_INPUT` when the quote has no driver. Never change the driver's details to make a vehicle fit.

The company sees the driver's age and licence with the request. They are removed together with the guest's other personal data after the retention period.

## What is not there

- No check of the actual driving licence or identity: the company does that at pick-up.
- No one-way rentals (pick-up and return at different places).
- No payment of the deposit through INNLI.
- Insurance options are yes or no with one deductible; packages to lower the deductible can be offered as paid options.
- Caravans and tents can be entered as vehicles, but towing rules (the weight a car may pull) are not checked.
