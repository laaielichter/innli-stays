# INNLI for hotels and busy properties

INNLI started with B&Bs, but it works just as well for a hotel with hundreds of rooms. This guide explains what INNLI adds for hotels and how to set it up. Everything also works for a B&B; if you do not need it, you will not notice it.

Try it with the sample hotel: `npm run demo` (or `npm run demo:intl`) starts INNLI with **Hotel Het Spaarne**: 48 rooms in four room types, two rate plans, instant booking and a FAQ. The keys are in `data/demo-credentials.json`.

## Room types with several rooms

A hotel does not sell single rooms but room types, such as "Standard double, 24 rooms".

- **Set it up:** Dashboard → *Rooms* → **Number of rooms of this type**.
- **Availability** counts, per night, how many rooms are taken: confirmed bookings, pending requests and short holds by agents. When all are taken, the type is sold out.
- **Room calendar:** the small number on each day is the number of free rooms. Click a day to stop selling that night (stop-sell).
- **Groups:** six people get, for example, 3 × Standard. Agents see `roomsOfThisType` and `roomsLeft`, and ask for several rooms at once with `rooms` (up to 10 per booking).
- **Calendars (iCal):** for a type with several rooms, each booking in the feed counts as one taken room.

## Rate plans

Next to your standard rate you can create up to ten rate plans (Dashboard → *Booking & details* → *Rate plans*). A plan has:

- a **price difference** in percent, for example −12% for non-refundable or +14% with breakfast;
- **refundable yes/no**, with its own cancellation conditions;
- optionally **breakfast included**.

With every price, agents get `ratePlanOptions`: the same stay in every plan, with the total and the conditions. The guest chooses, and the agent asks for that price with `ratePlanId`. On the stay page the guest picks the rate in the form. The chosen plan and its conditions go into the signed booking record.

## The answer assistant

Busy properties get the same questions over and over. The answer assistant answers them straight away, in English, Dutch, German or French. Can we bring the dog? Is there parking? Is there a lift?

- **Where the answers come from:** only the details you confirmed yourself, and questions you answered before and published as a FAQ. No language model is involved and nothing is made up.
- **What is not known** still comes to you. If the assistant can answer part of a question, that part is ready as a draft under the question. You add the rest.
- **Agents** use the `answer_question` tool, or get the answer straight away from `ask_host` when the assistant knows it.
- **Guests** use the *Ask us* box on the stay page.
- **To turn it off:** Dashboard → *Rules for requests* → *Answer assistant*.

## Changing instead of cancelling

When a guest wants other dates, another room or more rooms, the agent uses `modify_request`.

- **A pending request** is replaced right away.
- **A confirmed booking** stays valid until you (or instant booking) confirm the change. Only then is the old booking replaced, so the guest is never left without a room.

In the dashboard the new request carries the label *Change*.

## Holding rooms for a moment

With `get_quote({ hold: true })` an agent holds the rooms for 15 minutes while the guest decides. If the agent sends a request within that time, the hold carries over into the request. That way a busy hotel never sells its last room twice.

## Staff

Give everyone their own key (Dashboard → *Booking & details* → *Staff*):

| Role | May |
|---|---|
| **Reception** | Accept and decline requests, answer questions, room calendar (stop-sell), reviews, overview. Sees no secrets. |
| **Manager** | Everything reception may do, plus rooms, prices, rate plans, details and the webhook. |
| **Owner** | Everything, plus staff keys, the licence and backups. |

Every decision shows who made it ("handled by Noor"). When someone leaves, revoke their key; it stops working at once.

## Connecting your PMS or channel manager (webhook)

INNLI sends every event straight to an address of yours: a PMS, a channel manager, or Zapier/Make. Set it up under Dashboard → *Booking & details* → *Connection to your own system*.

| Event | When |
|---|---|
| `request.created` | New request, waiting for you |
| `booking.confirmed` | Confirmed, by you or instantly |
| `request.declined` | Declined |
| `request.expired` | Not answered in time |
| `request.cancelled` | Request withdrawn, or replaced by a change |
| `booking.cancelled` | Confirmed booking cancelled, or replaced by a change |

A message looks like this:

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

**Checking that a message really comes from INNLI:**

1. Read the header: `x-innli-signature: t=<unix time>,v1=<hex>`.
2. Compute HMAC-SHA256 over `<t>.<raw body>` with the secret shown in the dashboard.
3. Compare the result with `v1`. Reject messages whose `t` is more than 5 minutes old.

`unitRef` is the room type's *Code in booking system*; use it to map to your PMS.

**Delivery:** INNLI waits up to 10 seconds for an answer. On an error it retries after 5 seconds and after 1 minute. The last delivery or error is shown in the dashboard. A broken webhook never blocks a booking. Use *Send test message* to check the connection.

## Licence

The regular packages cover up to 20 rooms per property: enough for any B&B or guesthouse. Hotels have two packages:

| Package | Price | Hotels | Rooms | Updates | Renewal |
|---|---:|---:|---:|---|---:|
| **Hotel** | €699 | 1 | up to 150 | 1 year | €149 / year |
| **Hotel group** | €1,499 | up to 5 | no limit | 1 year | €349 / year |

Everything also works locally without a licence. The licence only decides what is listed in the INNLI guide. If a property has more rooms than the licence covers, the dashboard says which property was not listed, and why, when you register with the guide.

## Speed

Measured with `npm run bench` for a 300-room hotel with 10,000 bookings:

| What | Time |
|---|---:|
| Availability | ~1 ms |
| Price for 3 rooms with a rate plan | ~1 ms |
| 120-day room calendar | ~2.5 ms |
