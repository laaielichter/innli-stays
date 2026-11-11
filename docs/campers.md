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

**One camper?** Choose the starter pack *One campervan* or *One family motorhome* when you set up INNLI. It creates the vehicle and fills in the usual rental rules as suggestions. You check each one and press "Correct"; prices, deposit and deductible you always enter yourself.

As everywhere in INNLI, each answer has a status. A rule you did not state is *unknown*, not absent: an agent is told to ask you, and may not assume there is no age limit.

What stays the same: seasons and discounts, paid options (an extra driver, bikes), cancellation rules, booking requests or instant booking, the signed booking record, and the cleaning fee. Tourist tax is left out of the price: a camper pays it where it parks for the night.

## Ready to rent out?

INNLI shows a rental company to agents only after the owner confirmed what makes a rental insured and lawful in most countries. The dashboard lists it under **Ready to rent out?**:

| Required before you can be visible | Advised |
|---|---|
| Your insurer covers renting out to others | You check licence and identity at pick-up |
| Third-party liability insurance is in place | A damage report at pick-up and return |
| Your rental terms are online (a link) | A phone number for breakdown or damage |
| Minimum driver age, deposit, deductible per claim | Countries where the insurance is valid |
| Per vehicle: a valid roadworthiness inspection, the licence needed, seats with a belt | Whether prices include VAT; the vehicle's maximum mass |

INNLI cannot check any of this: you confirm it. The list is what is usual in most countries. It is not legal advice, and it does not replace your insurer or a lawyer. Rules on business registration, tax and consumer rights differ per country and are not covered.

A rental that would end after a vehicle's inspection runs out is not accepted.

The rule holds however a company got there. If a required answer is withdrawn later, or a stay is turned into a rental company, it is hidden from agents again until the list is complete. The inspection date is given as year-month-day, and the licence needed as B, C1 or C (or `car` outside Europe), so that the checks can read them.

## Insurance packages

The basic cover is in the passport: insurance included or not, the deductible per claim, liability, roadside assistance and the countries where it is valid.

A package that lowers the renter's risk is a paid option with an insurance part: its own deductible, and optionally its own deposit. Add it in the dashboard under paid options, or through the API:

```json
{ "id": "cover-plus", "name": "Cover Plus", "price": 12, "per": "night",
  "insurance": { "deductible": 500, "securityDeposit": 500, "covers": ["collision", "theft", "glass", "tyres"] } }
```

A guest takes at most one package. The quote, the consent summary and the booking record then carry the deductible and deposit of that package.

## Different countries

INNLI knows a few rules of thumb per country and uses them only to point things out. The company's own answer always decides.

| | What INNLI assumes | Where it is used |
|---|---|---|
| Europe (EU, EEA, Switzerland, UK) | Category B covers up to 3,500 kg; C1 up to 7,500 kg. A licence from another of these countries is not foreign | The owner is warned when a car licence is stated for a heavier vehicle |
| United States | A regular licence usually covers up to 26,000 lb; distances in miles | Kilometres are also given in miles (also in the UK) |
| Australia, New Zealand, Japan | Car licence up to 4,500 kg, 6,000 kg and 3,500 kg | As above |
| Canada and other countries | No default | The agent is told to ask the company |

For a licence from another part of the world the company states whether it is accepted, and whether an international driving permit is needed with it.

## For agents

Campers and places to stay are never mixed in one search.

1. **Search**: `search_stays({ kind: "camper", checkin, checkout, guests, requirements })`. Nights are rental days. Requirements for campers: `automatic_transmission`, `car_licence_ok`, `toilet_on_board`, `shower_on_board`, `winter_ready`, `unlimited_km`, `bike_rack`, `travel_abroad`. The party must fit the seats with a seat belt.
2. **Ask the guest who drives** and where to, then **quote**: `get_quote({ ..., driver: { age, licenceCategory, licenceYears, licenceCountry, hasInternationalPermit }, destinations: ["FR", "ES"] })`.
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
- `insurance.options` lists packages that lower the deductible. Add one to `extras` only when the guest wants it.
- `trip` (when you passed `destinations`) says whether the vehicle may go there and is insured there.
- `depositByCreditCardOnly`: tell the guest before they travel to the pick-up.
- `jurisdiction` is a rule of thumb for the company's country, with a disclaimer. It is never legal advice.
- `unknown` lists rental rules the company did not state. Do not fill them in.

4. **Consent**: `consent.summary` includes the kilometres, the deposit and the insurance. If the company changes one of them after the guest agreed, `request_booking` answers `TERMS_CHANGED`.
5. **Request**: `request_booking` as for a stay. It is refused with `DRIVER_NOT_ELIGIBLE` when the driver or the party breaks a rule, with `RENTAL_NOT_POSSIBLE` for a country the vehicle may not go to or is not insured in (or an inspection that runs out), and with `INVALID_INPUT` when the quote has no driver, or when the guest has not yet said something the company's rules need (which licence, how many years, an international permit). `rental.driver.missingFromGuest` lists exactly that.

The same checks run on every way in: an agent, a changed request, and the form on the company's public page. When only the company can answer something (a rule it did not state), the request is sent, but it is never confirmed automatically. Never change the driver's details to make a vehicle fit.

The company sees the driver's age and licence with the request. They are removed together with the guest's other personal data after the retention period.

## What is not there

- No check of the actual driving licence or identity: the company does that at pick-up.
- A camper cannot be booked through a UCP booking session: that draft has no place for a driver. Through an ACP checkout session it can, with a quote that has the driver as the item.
- The reasons a request is refused are in English, also on the company's public page in another language.
- No one-way rentals (pick-up and return at different places).
- No payment of the deposit through INNLI.
- INNLI does not sell or arrange insurance: it passes on what the company states about its own policy.
- No check of business registration, tax or local permits.
- Caravans and tents can be entered as vehicles, but towing rules (the weight a car may pull) are not checked.
