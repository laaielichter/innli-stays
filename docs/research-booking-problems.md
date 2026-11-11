# Problems with booking through AI agents (research, October 2026)

Nederlands: [nl/onderzoek-knelpunten.md](nl/onderzoek-knelpunten.md).

What goes wrong in practice with bookings through AI agents and at small accommodations, and how INNLI 0.5 responds to it. Sources are at the bottom.

## What goes wrong

### For agents and guests
1. **"Confirmed" when it is not yet.** An analysis from June 2026 showed that AI booking platforms often gave a confirmed status to bookings that were still pending. Unauthorised payments and cancellations without the user's permission also occurred. This raises a liability question that nobody answers: hotel, platform and AI vendor point at each other. (Morgan Lewis)
2. **Outdated or incomplete data.** Agents must see the current availability before they recommend anything. If they cannot, or if the information is incomplete, the accommodation drops out of the selection. Data is the real bottleneck. (XLR8, Hotel Tech Insight)
3. **Contradictory information.** Agents compare sources. If the website says check-in at 15:00 and another source says 14:00, trust drops. When sources contradict each other, the agent picks the consistent source, and that is almost always the OTA. (Quicktext, Hotel Tech Insight)
4. **Little visibility.** Only 6% of hotels appear consistently in AI recommendations; 82% of what AI recommends comes from OTAs and editorial media. (Quicktext)
5. **Guests do not trust it yet.** Travellers say they are not yet ready to let an AI book. (Skift)

### For small accommodations
6. **Dependence on OTAs.** The share of OTAs in bookings of independent hotels rose to 63.4% (2025), at 15–22% commission. AI agents that find no live rates or booking link from the hotel send the guest to Booking.com. (BookingWhizz, The Hotel Blueprint)
7. **Double bookings.** If an agent states availability that does not match the real inventory, booking conflicts arise and trust disappears. (BookingWhizz)
8. **No time to respond.** Because of staff shortages, requests are left unanswered. (BookingWhizz)
9. **No-shows and payments.** Broken or missing payment links and unclear deposits are a major source of complaints. A deposit of 30–50%, reminders before arrival and clear cancellation deadlines reduce no-shows. (Runnr.ai, SmartOrder)

### Technology
10. **Production-ready agent connections** need permissions per party (see only what is allowed), and a clear distinction between "succeeded" and "partly succeeded", so that an agent does not present an incomplete answer as the truth. (MCP specification, Visiting Media)
11. **Payment by agents** is being standardised (Google AP2, OpenAI/Stripe ACP, Visa Trusted Agent Protocol, Mastercard Agent Pay), but is still changing fast.

## What INNLI 0.5 does about it

| # | Problem | Solution |
|---|---|---|
| 1 | False confirmations, cancelling without permission | Fixed statuses (`new` → `accepted` / `declined` / `expired` / `cancelled`), `booked: true` only on a real confirmation, cancelling only with `guestConsent`, and a **booking record** per request: price lines, conditions and consent as they were at that moment. Plus a **log** of all agent actions. |
| 2, 7 | Outdated availability, double bookings | **Holding the room** during a request, so that nobody else gets it. **Fresh calendar check** just before confirming. **Double booking warning** when another channel sells the same night. |
| 3 | Contradictory data | **Consistency check**: website versus passport, per detail (check-in, breakfast, tourist tax, cleaning, dogs…). |
| 4 | Invisible because of missing data | **"What agents search for"**: which requirements guests set, and which unknown details cost you chances, with what you need to confirm. |
| 6 | OTA dependence | **Direct booking perk** as a passport detail that agents mention. Direct requests and bookings without commission. |
| 8 | No time to respond | **Instant booking** according to the owner's rules (days ahead, maximum number of nights). Requests **expire automatically**, with a message to the guest. **Reminder** to the owner after 12 hours. **Response time** visible to agents. |
| 9 | No-shows, payments | **Deposit** with the owner's own payment instructions or payment link. INNLI does not handle any money itself. Plus a **message before arrival** with check-in times and a reminder of an outstanding deposit. |
| 10 | Production connections | **Permissions per agent key** (`read` / `act`), limits per agent, readable error messages; with every status, agents get an explicit `next` (next step). |
| 11 | Agent payments | Deliberately not yet: the guest pays the owner directly. As soon as AP2/ACP are stable, a payment step fits onto the booking record. |

## Sources
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
