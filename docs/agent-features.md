# 300 features for AI agents

Nederlands: [nl/agent-features.md](nl/agent-features.md).

Status: ✅ built and tested · 🔜 next step (highest value) · 💡 later

The starting point for every feature: an agent must be able to help a guest **honestly**. What is confirmed it states as fact, what is unknown it says so, and nothing is called booked until the owner confirms it.

**Part 1 status: 87 built, 1 next step, 12 later. Total (300): 214 built (updated in 1.1).**

## A. Searching and matching

| # | Feature | Status | Tool / place |
|---|---|---|---|
| 1 | Search by town, region or country | ✅ | `search_stays` |
| 2 | Search around a point with a radius (km) | ✅ | `search_stays.near` |
| 3 | 13 hard requirements: dog, enclosed garden, ground floor, step-free, walk-in shower, long bed, private bathroom/entrance, quiet, parking, breakfast, children | ✅ | `search_stays.requirements` |
| 4 | Requirements derived automatically from the party (dogs, children) | ✅ | `search_stays` |
| 5 | Per requirement: confirmed / unconfirmed / unknown / not met | ✅ | `criteria[].level` |
| 6 | Only matches confirmed by the owner | ✅ | `confirmedOnly` |
| 7 | Budget including all mandatory costs | ✅ | `maxTotalPrice` |
| 8 | Sort by best match, price or distance | ✅ | `sort` |
| 9 | Explanation of why accommodations were dropped (taken, over budget) | ✅ | `excluded` |
| 10 | Several rooms for one group (family of 5 → 2 rooms) | ✅ | search_stays (rooms), get_quote rooms |

## B. Availability and dates

| # | Feature | Status | Tool / place |
|---|---|---|---|
| 11 | Live availability from the booking system | ✅ | `check_availability` |
| 12 | Several calendars per room (Airbnb, Booking.com, Google Calendar) | ✅ | iCal connection |
| 13 | Room calendar that the owner keeps up to date | ✅ | dashboard |
| 14 | Certainty per answer: live, synchronised or no source | ✅ | `certainty` |
| 15 | Flexible dates: all possible arrival days in a period, with price | ✅ | `find_available_dates` |
| 16 | Weekends only | ✅ | `weekendsOnly` |
| 17 | Monthly calendar per room with price per night | ✅ | `get_availability_calendar` |
| 18 | Unreadable calendar = unknown, never "free" | ✅ | |
| 19 | Flexible dates across several accommodations at once | ✅ | search_stays flexibleDates (+ pattern) |
| 20 | Waiting list: message when a room becomes free | 💡 | |

## C. Price and quote

| # | Feature | Status | Tool / place |
|---|---|---|---|
| 21 | Itemised total price with all mandatory costs | ✅ | `get_quote` |
| 22 | Flag when a mandatory item is unknown | ✅ | `totalIncludesAllMandatoryCosts` |
| 23 | Live rates per night | ✅ | live connection |
| 24 | Seasons, weekend surcharge, minimum number of nights | ✅ | owner's rates |
| 25 | Price per night in the quote | ✅ | `nightly` |
| 26 | Validity period of the quote | ✅ | `validUntil` |
| 27 | Conditions in the quote: cancellation, check-in and check-out, dogs, dietary needs, direct booking perk | ✅ | `policies` |
| 28 | Ready-made summary for the guest | ✅ | `summaryForGuest` |
| 29 | Discounts: long stay, last minute | ✅ | get_quote (discount) |
| 30 | Deposit with the owner's payment instructions or payment link (against no-shows) | ✅ | `payment` |

## D. Information about the stay

| # | Feature | Status | Tool / place |
|---|---|---|---|
| 31 | Passport with about 40 concrete details | ✅ | `get_stay_details` |
| 32 | Source, evidence and check date per detail | ✅ | |
| 33 | Explicit list of unknown deciding details | ✅ | `facts.unknown` |
| 34 | Signal when a detail has not been checked for more than a year | ✅ | `needsRecheck` |
| 35 | Room level: bed length, steps, door width, shower, noise | ✅ | |
| 36 | Compare accommodations side by side | ✅ | `compare_stays` |
| 37 | Photos per room with description | ✅ | get_stay_details photos |
| 38 | Distances to station, beach, centre (confirmed by the owner) | ✅ | pointsOfInterest, nearPlace |
| 39 | Descriptions in several languages by the owner | 💡 | |
| 40 | Experiences of guests with a verified stay | 💡 | |

## E. Booking and requests

| # | Feature | Status | Tool / place |
|---|---|---|---|
| 41 | Direct booking link with dates and guests filled in | ✅ | `prepare_booking` |
| 42 | Request through the property's own stay page | ✅ | `prepare_booking` |
| 43 | Send a request from the agent, with the guest's permission | ✅ | `request_booking` |
| 44 | No duplicate requests on a retry | ✅ | `idempotencyKey` |
| 45 | Follow the status: request, accepted, declined | ✅ | `check_status` |
| 46 | Accepting closes the nights, also on Airbnb/Booking.com | ✅ | |
| 47 | Instant booking within the owner's rules; otherwise never "booked" before confirmation | ✅ | `booked`, `instantBooking` |
| 48 | Cancellation by the guest (through the agent or the status page), nights open up again | ✅ | `cancel_request` |
| 49 | Holding the room during a request, with automatic expiry | ✅ | `holdUntil` |
| 50 | Real reservation through the booking system's API | 💡 | |

## F. Contact with the owner

| # | Feature | Status | Tool / place |
|---|---|---|---|
| 51 | Ask the owner a question, e.g. about an unknown detail | ✅ | `ask_host` |
| 52 | The owner's answer becomes a confirmed detail for all future guests | ✅ | |
| 53 | E-mail to the owner on a request or question | ✅ | SMTP |
| 54 | Answer by e-mail to the guest (with permission) | ✅ | `replyEmail` |
| 55 | Message from the owner visible to the agent | ✅ | `check_status.hostMessage` |
| 56 | Earlier answers as frequently asked questions for agents | ✅ | get_stay_details faq, answer_question |
| 57 | Push notification to the owner (phone) | ✅ | ntfy |
| 58 | The owner's response time and confirmation rate visible to agents | ✅ | `host` |
| 59 | Reminders: owner for an open request, guest before arrival | ✅ | scheduler |
| 60 | Suggest an alternative date when declining | 💡 | |

## G. Trust and security

| # | Feature | Status | Tool / place |
|---|---|---|---|
| 61 | Key per agent partner | ✅ | |
| 62 | Limits against abuse (per IP and per agent) | ✅ | |
| 63 | Guest's permission required for name and e-mail | ✅ | `guestConsent` |
| 64 | Guest data only at the B&B; deleted automatically | ✅ | retention period |
| 65 | Guide checks the licence and ownership of the address | ✅ | |
| 66 | Signed reporting back of bookings | ✅ | HMAC |
| 67 | No access to internal networks through connections | ✅ | |
| 68 | Permissions per agent key (read only / also act) | ✅ | `scopes` |
| 69 | Log of agent actions and booking record (price, conditions, consent) | ✅ | `record`, dashboard |
| 70 | Signed responses, so that agents can check the origin | 💡 | |

## H. Connection and protocol

| # | Feature | Status | Tool / place |
|---|---|---|---|
| 71 | MCP over Streamable HTTP | ✅ | `/mcp` |
| 72 | MCP over stdio (local) | ✅ | |
| 73 | One guide address for all self-hosted B&Bs | ✅ | INNLI guide |
| 74 | All 12 tools also through the guide | ✅ | |
| 75 | Readable error messages instead of crashes | ✅ | |
| 76 | Instructions with honesty rules for agents | ✅ | |
| 77 | Strict output schemas per tool | 🔜 | |
| 78 | Passport as an MCP resource | ✅ | innli://stay/{id} |
| 79 | REST variant for agents without MCP | 💡 | |
| 80 | Support for new agent protocols | 💡 | |

## I. Measurement

| # | Feature | Status | Tool / place |
|---|---|---|---|
| 81 | From agent query to confirmed booking | ✅ | dashboard |
| 82 | Broken down per agent | ✅ | |
| 83 | Crawlers separate, never counted as a guest | ✅ | |
| 84 | Requests through the stay page and the agent counted | ✅ | |
| 85 | Booking traced back to the agent that brought the guest | ✅ | `ref` |
| 86 | Which requirements agents set most often | ✅ | dashboard *What agents search for* |
| 87 | Missed chances: dropped and why, with what you need to confirm | ✅ | dashboard *What agents search for* |
| 88 | Report for agent partners | 💡 | |
| 89 | Monthly report by e-mail to the owner | 💡 | |
| 90 | Comparison with similar B&Bs (anonymised) | 💡 | |

## J. Findability outside the connection

| # | Feature | Status | Tool / place |
|---|---|---|---|
| 91 | Stay page with schema.org | ✅ | `/verblijf/…` |
| 92 | robots.txt: search and training crawlers separate | ✅ | plugin, audit |
| 93 | Website audit, including contradictions between website and passport | ✅ | dashboard |
| 94 | WordPress plugin with data from confirmed facts | ✅ | |
| 95 | Request form on the property's own website | ✅ | `[innli_request]` |
| 96 | Read a website into a draft passport | ✅ | |
| 97 | Sitemap and robots.txt for stay pages | ✅ | `/sitemap.xml` |
| 98 | Share preview for links in chat apps | ✅ | Open Graph |
| 99 | Warning on a double booking with another channel | ✅ | scheduler, dashboard |
| 100 | Export the passport for Google Business Profile | 💡 | |

---

# Part 2: 200 new features (#101–#300)

Added in version 0.6. **Part 2 status: 127 built, 12 next step, 61 later.** Here too: ✅ built and tested · 🔜 next step · 💡 later.

A deliberate choice: new features are, as much as possible, **options within existing tools**, not new tools every time. The more tools an agent sees at once, the more often it picks the wrong one. One was added (`join_waitlist`, 13 in total); in 0.7 three were added (`answer_question`, `modify_request`, `report_data_issue`, 16 in total). Version 1.1 adds no tools, only options within existing tools.

## K. Groups and families

| # | Feature | Status | Where |
|---|---|---|---|
| 101 | Group too large for one room: combination of 2–3 rooms in one accommodation | ✅ | `search_stays` → `rooms` |
| 102 | Split the party with at least one adult per room | ✅ | `splitParty` |
| 103 | Fewest rooms and fewest empty beds first | ✅ | |
| 104 | Requirements checked per room with the part of the party in that room | ✅ | |
| 105 | Quote per room and a total for the group | ✅ | `offer.rooms`, `offer.total` |
| 106 | Request a group in one go | ✅ | `request_booking({ quoteIds })` |
| 107 | All or nothing: the owner confirms or declines all rooms together | ✅ | |
| 108 | If one room fails during the request, the others are released | ✅ | |
| 109 | Cancel a group in one go | ✅ | `cancel_request` |
| 110 | One e-mail to owner and guest for the whole group | ✅ | |
| 111 | Instant booking for groups (if all rooms fall within the rules) | ✅ | |
| 112 | Group as one card in the dashboard | ✅ | |
| 113 | Groups also through the INNLI guide | ✅ | |
| 114 | Deposit added up for the whole group | ✅ | |
| 115 | Groups across several accommodations in the same town | 💡 | |
| 116 | Preference for rooms next to each other or on the same floor | 🔜 | |
| 117 | Cot or extra bed as an option per room | ✅ | extras (cot as an option) |
| 118 | Maximum number of children per room | 💡 | |
| 119 | Different arrival days per room within one group | 💡 | |
| 120 | Rent the whole accommodation (all rooms) as one offer | 🔜 | |

## L. Dates and flexibility

| # | Feature | Status | Where |
|---|---|---|---|
| 121 | Flexible dates in `search_stays`: first free period per accommodation | ✅ | `flexibleDates` |
| 122 | Flexible dates for groups too | ✅ | |
| 123 | Limited number of checks with live booking systems (max. 14 dates) | ✅ | |
| 124 | Alternative dates on a declined or expired request | ✅ | `check_status.alternatives` |
| 125 | Alternatives around the requested dates (−7 to +14 days) | ✅ | |
| 126 | Places nearby as a search filter ("near the beach") | ✅ | `nearPlace` |
| 127 | Agent can choose the language of the description | ✅ | `language` |
| 128 | Which languages are available | ✅ | `availableLanguages` |
| 129 | Public holidays/school holidays as a date hint | 💡 | |
| 130 | "Long weekend" (Fri–Mon) as a fixed choice | ✅ | flexibleDates.pattern long_weekend |
| 131 | Minimum number of nights per arrival day (e.g. Saturday) | ✅ | checkinDays + minNights per season |
| 132 | Arrival only on certain days | ✅ | checkinDays |
| 133 | Check-in time on request (early check-in) | 💡 | |
| 134 | Signal the last free rooms ("1 room left") | ✅ | check_availability fewLeft / roomsLeft |
| 135 | Availability for several months in one answer | 💡 | |
| 136 | Travel time by public transport from a given place | 💡 | |
| 137 | Search along a route (stops on the way, e.g. a cycling holiday) | 💡 | |
| 138 | Suggest quiet periods (less busy, lower price) | 💡 | |
| 139 | Search by special type of stay (tree house, windmill, farm) | 🔜 | |
| 140 | Search by price per night instead of total | ✅ | search_stays maxPricePerNight |

## M. Price and discounts

| # | Feature | Status | Where |
|---|---|---|---|
| 141 | Discount for a long stay | ✅ | `rates.discounts.longStay` |
| 142 | Last-minute discount | ✅ | `lastMinute` |
| 143 | Early booking discount | ✅ | `earlyBird` |
| 144 | The highest discount counts, discounts do not stack | ✅ | |
| 145 | Discount as a separate, visible line in the quote | ✅ | |
| 146 | Discounts never on live rates (the booking system calculates those itself) | ✅ | |
| 147 | Discounts visible to agents per room | ✅ | `units[].discounts` |
| 148 | Discounts can be set in the dashboard | ✅ | |
| 149 | Discount code from the owner | ✅ | get_quote discountCode |
| 150 | Discount for returning guests | 💡 | |
| 151 | Options with a price: bikes, packed lunch, late check-out | ✅ | get_quote extras |
| 152 | Surcharge for a single night | ✅ | singleNightSupplement |
| 153 | Price per person instead of per room | 💡 | |
| 154 | VAT breakdown on the quote | 💡 | |
| 155 | Indicative price in other currencies | 💡 | |
| 156 | Price guarantee: direct is as cheap as on booking sites | 💡 | |
| 157 | Price comparison per night over a period | 🔜 | |
| 158 | Rate valid until (price freeze for x hours) | ✅ | `validUntil` |
| 159 | Calculate cancellation costs according to the conditions | ✅ | cancellationCosts, cancellationCostIfCancelledNow |
| 160 | Tourist tax per municipality automatically | 💡 | |

## N. Content and trust

| # | Feature | Status | Where |
|---|---|---|---|
| 161 | Photos of the accommodation with description | ✅ | `photos` |
| 162 | Photos per room | ✅ | `units[].photos` |
| 163 | Photos in schema.org | ✅ | |
| 164 | Only https photos | ✅ | |
| 165 | Places nearby with distance and walking time | ✅ | `pointsOfInterest` |
| 166 | Description in English, German, French | ✅ | `translations` |
| 167 | Frequently asked questions from real guest questions | ✅ | `faq` |
| 168 | Owner chooses per answer whether it becomes an FAQ | ✅ | |
| 169 | Manage photos, surroundings and translations in the dashboard | ✅ | |
| 170 | Stay page with photo gallery and "Nearby" | ✅ | |
| 171 | Upload photos in the dashboard (now: links) | ✅ | dashboard: Upload photo |
| 172 | Automatic alt text check (description is missing or vague) | ✅ | /photos/check |
| 173 | Floor plan or room description per floor | 💡 | |
| 174 | Accessibility photos (threshold, shower) linked to facts | 💡 | |
| 175 | Translation by AI as a draft, owner approves | 💡 | |
| 176 | Sustainability details (solar panels, eco label) | ✅ | eco.* details, requirement eco_label/ev_charging |
| 177 | House rules as a structured list | ✅ | rules.* details, requirement non_smoking |
| 178 | Noise information per room visible on the page | 🔜 | |
| 179 | Check for contradictions between photo captions and facts | 💡 | |
| 180 | Quality score for photos and description | 💡 | |

## O. Waiting list and second chances

| # | Feature | Status | Where |
|---|---|---|---|
| 181 | Put a guest on the waiting list | ✅ | `join_waitlist` |
| 182 | Only with the guest's permission | ✅ | `guestConsent` |
| 183 | Automatic message as soon as a room becomes free | ✅ | scheduler |
| 184 | Message with a pre-filled request link | ✅ | |
| 185 | Waiting list status through `check_status` | ✅ | |
| 186 | Waiting list entry expires after the arrival date; e-mail address deleted | ✅ | |
| 187 | At most 3 entries per guest per accommodation | ✅ | |
| 188 | Owner sees how many guests are waiting | ✅ | dashboard |
| 189 | Waiting list also through the guide | ✅ | |
| 190 | Waiting list for any room that fits (not one specific room) | ✅ | |
| 191 | Waiting list with flexible dates | 🔜 | |
| 192 | Waiting list guest gets priority (short hold) | 💡 | |
| 193 | Suggest alternative accommodations when it is full | ✅ | check_availability alternatives |
| 194 | Reminder to the guest when a request is about to expire | 💡 | |
| 195 | Request the second choice automatically if the first declines | 💡 | |
| 196 | Declined request: reason in categories (full, too short, dogs) | 🔜 | |
| 197 | Warning to the agent when the owner responds slowly | ✅ | `host.medianResponseHours` |
| 198 | Inform guests in case of illness or force majeure on the owner's side | 💡 | |
| 199 | Rebook to other dates (instead of cancelling) | ✅ | modify_request |
| 200 | Rebook to another room | ✅ | modify_request |

## P. Reviews and proof

| # | Feature | Status | Where |
|---|---|---|---|
| 201 | Reviews only from confirmed, completed stays | ✅ | |
| 202 | Invitation the day after departure | ✅ | scheduler |
| 203 | One review per stay | ✅ | |
| 204 | Owner can reply, not delete | ✅ | |
| 205 | Average and recent reviews for agents | ✅ | `reviews` |
| 206 | Reviews on the stay page, without a name | ✅ | |
| 207 | Signed booking record (Ed25519) | ✅ | `signedRecord`, `signature` |
| 208 | Public key of the installation | ✅ | `/.well-known/innli.json` |
| 209 | Fixed order (canonical JSON), so it can be verified | ✅ | |
| 210 | A tampered record fails the check | ✅ | test |
| 211 | Review per aspect (breakfast, cleanliness, quiet) | ✅ | review per aspect |
| 212 | Reviews in several languages | 💡 | |
| 213 | Review linked to the confirmed facts ("garden was as stated") | 💡 | |
| 214 | Signed reviews | 💡 | |
| 215 | Proof of stay for the guest (signed) | 💡 | |
| 216 | Disputes: export the record as PDF | 💡 | |
| 217 | Timestamp from an independent party | 💡 | |
| 218 | Signed facts (passport attestation) | 💡 | |
| 219 | Let agents check whether a record really comes from the installation | ✅ | `verifyRecord` |
| 220 | Average review score in search results | ✅ | search_stays rating |

## Q. Protocols and integration

| # | Feature | Status | Where |
|---|---|---|---|
| 221 | REST API for agents without MCP | ✅ | `/api/agent/v1/tools/{tool}` |
| 222 | OpenAPI 3.1 specification (e.g. for ChatGPT GPT Actions) | ✅ | `/api/agent/v1/openapi.json` |
| 223 | REST with the same keys, permissions and limits as MCP | ✅ | |
| 224 | MCP resources: passport per stay | ✅ | `innli://stay/{id}` |
| 225 | List of all stays as resources | ✅ | |
| 226 | MCP prompt `plan_stay` with an honest step-by-step plan | ✅ | |
| 227 | One handler table for MCP and REST (one source of truth) | ✅ | |
| 228 | Request ID per request, also in error messages | ✅ | `x-request-id` |
| 229 | `Retry-After` on overload | ✅ | |
| 230 | Caching of public data (ETag / 304) | ✅ | |
| 231 | Health check with version and counts | ✅ | `/health` |
| 232 | Output schema per tool | 🔜 | |
| 233 | OAuth 2.1 for agent platforms | ✅ | OAuth 2.1 (/.well-known/oauth-*) |
| 234 | Web Bot Auth: agents that identify themselves cryptographically | 💡 | |
| 235 | Webhooks for agent platforms on a status change | ✅ | request_booking callbackUrl |
| 236 | Server-sent events for live status | 💡 | |
| 237 | MCP elicitation: ask for permission through the agent app | 💡 | |
| 238 | A2A or other emerging agent protocols | 💡 | |
| 239 | Connection with specific booking systems | ✅ | Beds24 |
| 240 | iCal export of confirmed INNLI bookings for the owner | ✅ | booking calendar (iCal) |

## R. Owner: notifications and reporting

| # | Feature | Status | Where |
|---|---|---|---|
| 241 | Push notification on the phone for a new request | ✅ | ntfy |
| 242 | Push notification for an instant booking | ✅ | |
| 243 | Push notification for a question from a guest | ✅ | |
| 244 | Push notification for a possible double booking | ✅ | |
| 245 | A failed push notification never breaks a booking | ✅ | |
| 246 | Monthly overview by e-mail | ✅ | scheduler |
| 247 | Monthly overview only once a month | ✅ | |
| 248 | Report per agent partner (from query to booking) | ✅ | `/api/admin/agents/report` |
| 249 | Export for Google Business Profile (confirmed facts only) | ✅ | dashboard *Findability* |
| 250 | Set up push notifications in the dashboard | ✅ | |
| 251 | WhatsApp notification | 💡 | |
| 252 | Quiet hours (no notifications at night) | 🔜 | |
| 253 | Accept or decline from the notification | 💡 | |
| 254 | Weekly overview instead of monthly | 🔜 | |
| 255 | Occupancy rate per month | ✅ | dashboard: Occupancy and revenue |
| 256 | Revenue per channel (agent, stay page, website) | ✅ | dashboard: Occupancy and revenue |
| 257 | Export of bookings to Excel/CSV | ✅ | CSV export |
| 258 | Accounting export | 💡 | |
| 259 | Several users per accommodation | 💡 | |
| 260 | Multilingual dashboard (EN/DE) | 💡 | |

## S. Performance and reliability

Measured with `npm run bench`, see [performance.md](performance.md).

| # | Feature | Status | Where |
|---|---|---|---|
| 261 | Storage as an append-only log: storing an event takes 0.02 ms instead of 1.3 s | ✅ | `src/store.ts` |
| 262 | Indexes on token, accommodation and key | ✅ | |
| 263 | Changes batched and only converted when written to disk | ✅ | |
| 264 | Logs are cleaned up periodically | ✅ | |
| 265 | Automatic migration of the old storage | ✅ | |
| 266 | Resistant to a half-written line after a crash | ✅ | |
| 267 | Search across live booking systems in parallel (9× faster) | ✅ | |
| 268 | Flexible dates in parallel, with a limit per owner | ✅ | |
| 269 | Search insights as daily totals: storage stays bounded | ✅ | |
| 270 | Benchmark with 300 accommodations, 20,000 requests, 200,000 events | ✅ | `npm run bench` |
| 271 | Old quotes and search totals cleaned up automatically | ✅ | |
| 272 | Time limit on every external connection | ✅ | |
| 273 | Cache of calendars (15 min), fresh when confirming | ✅ | |
| 274 | Database storage (Postgres/SQLite) for large installations | 💡 | |
| 275 | Several servers side by side (horizontal scaling) | 💡 | |
| 276 | Automatic backup to a second location | ✅ | INNLI_BACKUP_DIR |
| 277 | Restore a backup in the dashboard | ✅ | Restore in the dashboard |
| 278 | Performance measurement in production | 🔜 | |
| 279 | Circuit breaker for slow booking systems | 🔜 | |
| 280 | Status page for agent partners | 💡 | |

## T. Future: paying, identity, reserving

| # | Feature | Status | Where |
|---|---|---|---|
| 281 | Pay through an agent (Google AP2 / OpenAI ACP) | 💡 | once stable |
| 282 | Deposit through the owner's iDEAL link, checked automatically | 💡 | |
| 283 | Refund on cancellation according to the conditions | 💡 | |
| 284 | Identity of the guest through the agent (verified e-mail address) | 💡 | |
| 285 | Agent identity through Visa/Mastercard agent protocols | 💡 | |
| 286 | Real reservation in the booking system through the API | 💡 | |
| 287 | Online check-in before arrival | 💡 | |
| 288 | Digital key or key safe code after payment | 💡 | |
| 289 | Fill in the guest register (mandatory in the Netherlands) digitally | 💡 | |
| 290 | Prepare the tourist tax return | 💡 | |
| 291 | Voice agent (phone) on the same data | 💡 | |
| 292 | Chat widget on the property's own website on the same data | 💡 | |
| 293 | Packages (stay + bike hire + dinner) with partners | 💡 | |
| 294 | Gift vouchers | 💡 | |
| 295 | Loyalty for returning guests | 💡 | |
| 296 | Multilingual e-mails to guests | ✅ | e-mails in nl/en/de/fr |
| 297 | Guest chooses the language on the stay page | ✅ | ?lang= and language choice |
| 298 | Guest app (PWA) with information about the stay | 💡 | |
| 299 | Cooperation with the local tourist office/regional marketing as an agent partner | 💡 | |
| 300 | Benchmark for owners against comparable B&Bs (anonymous) | 💡 | |
