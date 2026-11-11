# Guide for owners

This guide is for B&B owners. The technical installation is described in [hosting.md](hosting.md).

## 1. Starting for the first time

1. Start INNLI (`npm start`, or `docker compose up -d`).
2. An **installation code** appears in the window (it is also in `data/installatiecode.txt`).
3. Open the dashboard (`http://localhost:3000/dashboard/`) and enter the code, your name, your town and your first room.
4. You receive an **owner key**. Keep it safe (in a password manager): you use it to log in.

Lost it? `npm run innli -- new-key <id>` creates a new one (stop INNLI first).

## 2. The dashboard

At the top of **Overview** there is a *Getting started* checklist. Work through it from top to bottom.

| Tab | What you do there |
|---|---|
| **Requests** | Accept or decline requests from guests |
| **Passport** | Confirm facts about your accommodation (dogs, garden, breakfast, costs…). Or let INNLI read your website and check its suggestions. |
| **Rooms** | Rooms, prices, **seasonal rates**, and the **room calendar** (nights open/closed) |
| **Booking & details** | Address, e-mail, calendar links (Airbnb, Booking.com, Google Calendar) or your booking system |
| **Findability** | A check of your website for search engines and AI search tools |
| **Agent view** | Exactly what an AI agent sees about your stay |

**Why confirm?** Agents only state confirmed details as fact. When something is unknown, they say so honestly. The more you confirm, the better you match specific questions ("enclosed garden for my dog", "ground-floor room").

## 3. Languages and currency

- You can switch the dashboard between Dutch and English with the language menu in the top bar. Your browser remembers the choice.
- Under *Booking & details → Basic details* you set:
  - **Language of your texts**: the language your description is written in (Dutch, English, German or French);
  - **Currency**: EUR, GBP, CHF, DKK, SEK, NOK, PLN, CZK, HUF, RON, ISK, USD, CAD, AUD or NZD. By default this is the usual currency of your country.
- Under *Photos, surroundings and translations* you can add your description in the other languages.
- Guests see your stay page in Dutch, English, German or French. It follows the guest's browser, and there is a language switch. E-mails to guests go out in the guest's language.
- E-mails to you are in Dutch or English, following the language of your texts. For other languages they are in English.
- INNLI never converts currencies. Agents compare prices within one currency.

## 4. Availability

Choose one of these under *Booking & details*:

- **I keep track of open rooms in INNLI myself.** Click days in *Rooms → Room calendar* to close them.
- **My calendars.** Paste the export links (iCal) from Airbnb, Booking.com and/or your Google Calendar. Booked in one calendar = booked.
- **Booking system with a live connection.** If your booking system supports it.
- **Beds24.** In Beds24, under *Settings → Account → Access*, create an invite code with read access to *inventory*. Exchange it for a refresh token and paste that into INNLI. For every room, fill in its Beds24 room id as *Code in booking system*. INNLI then reads availability, prices and minimum stay live from Beds24.

Do you also use Airbnb or Booking.com? Add the **export link** from your room calendar there as an external calendar. Nights you close in INNLI are then closed there too.

## 5. Rates

For each room: a base price, and optionally under *Rates*:

- **Seasons** (e.g. *Summer* 06-15 to 08-31 for € 135, minimum 3 nights). A season applies every year.
- **Weekend supplement** for Friday and Saturday nights.
- **Discounts**: long stay (e.g. 10% from 7 nights), last minute (within a number of days) and early booking (at least a number of days ahead). The highest discount that applies is used; discounts do not add up. The guest sees the discount as a separate line in the price. Discounts only work on your own rates. A live booking system does its own calculation.

In the passport, also fill in **cleaning costs** and **tourist tax** (0 if they do not apply). Otherwise guests see "not all costs known yet".

**Rate plans** (Booking & details): next to your standard rate, for example a cheaper non-refundable rate or a rate including breakfast. Agents let the guest choose.

Do you have several identical rooms, as in a hotel? Fill in **Number of rooms of this type** for the room. See [hotels.md](hotels.md), also for staff accounts and a connection to your PMS.

### Arrival days and short stays

Per room, under *Rates*:

- **Arrival days:** e.g. "sat" for Saturday to Saturday, or "fri, sat". You can set this per season (column *Arrival on*) or for the rest of the year. Requests for another day still come in, but are not confirmed instantly: you decide.
- **Supplement for one night:** an amount per room for stays of exactly one night.

### Options, discount codes and cancellation costs (Booking & details)

- **Paid options:** bike hire, packed lunch, late check-out, a cot. An option costs an amount per stay, per night, per person, per person per night or per room per night, up to a maximum quantity. Agents and guests on your stay page can add them. They appear as a separate line in the price.
- **Discount codes:** for returning guests, your newsletter or a partner. You set:
  - the percentage;
  - optionally: the last arrival date the code is valid for, a minimum number of nights, and how often it can be used.

  Codes stay secret. Agents only see that you accept codes, and ask the guest for one.
- **Cancellation costs:** rules such as "less than 7 days before arrival: 50%". With every price, agents see what cancelling costs from which date. For a booking, they also see what cancelling costs right now. A non-refundable rate plan always costs 100%.

## 6. Handling requests

Guests (through an AI agent or your stay page) send a **request**. This is not yet a booking.

- **Accept:** the nights are closed automatically in your room calendar, and the booking counts in your statistics.
- **Decline:** with an optional message (e.g. an alternative date).

If e-mail is set up (`INNLI_SMTP_URL`, the details of your own mailbox), you get an e-mail for every request, and the guest is told automatically. Without e-mail, you see requests in the dashboard and e-mail the guest yourself.

### Groups

If a group does not fit in one room, an agent can request 2 or 3 rooms at once. You see these as **one card** in *Requests*. Accepting or declining applies to all the rooms together. The guest gets one confirmation.

### Rules for requests (Booking & details)

- **Instant booking**: requests that meet your rules (e.g. at least 2 days ahead, at most 7 nights) are booked straight away. Agents and guests prefer this. INNLI checks your calendars again just before confirming.
- **Hold the room**: while a request is open (48 hours by default), nobody else can request those nights. If you do not reply in time, the request expires and the guest is told. After 12 hours you get a reminder.
- **Deposit**: choose a percentage, a deadline and your payment instructions (IBAN) or a payment link (Mollie, Stripe, Tikkie). The guest receives this with the confirmation; you mark the deposit as *Received*. INNLI does not handle any money itself.
- A few days before arrival, the guest automatically gets a message with check-in times and the address.
- If a guest cancels, the nights open again. You are told, together with the cancellation terms that applied when the request was made. You settle any costs with the guest yourself.

### Log and double bookings

Under *Requests → Agent action log* you see everything agents did on behalf of guests. If a night booked through INNLI is also booked in Airbnb or Booking.com, you get a warning (at the top of *Overview* and by e-mail).

### Waiting list

If a stay is full, an agent can put the guest on the waiting list (with their permission). Does a room become free because someone cancels, a request expires or you open nights? Then the guest automatically gets an e-mail with a pre-filled request link. In *Requests* you can see how many guests are waiting.

### Wanted: guests who have not found anything yet

When a guest finds nothing that fits, the AI agent leaves a **stay wish**: place, dates or a period, the party, wishes (bringing a dog, enclosed garden …) and the budget. You never see who the guest is. Names and contact details are removed from the note.

The *Wanted* tab lists the wishes your stay fits by place and size, with:
- the room that fits best;
- which wishes you confirmed and which are still unknown;
- for fixed dates: your own price, and whether it stays within the budget.

**Making an offer:**
1. Choose the room.
2. Choose the dates, if the guest gave a period.
3. Add a discount if you like (up to 50%).
4. Write a short message if you like.
5. Choose how long the offer is valid.

The agent gets a current price with your discount. The discount is a one-time code that only works for this guest. If the guest chooses your offer, it arrives as a normal request, or as a booking with instant booking. With push notifications on, you hear about every new wish. Reception staff can see wishes; the owner or a manager makes offers.

If guests book you in your own booking system (live connection), you can still make an offer, but without a discount: your booking system does not know the code.

### Questions from guests and frequently asked questions

Guests can ask you a question through an agent. If it is about a detail in your passport, your answer becomes a confirmed detail straight away. Tick *Also show as a frequently asked question*, and future guests and agents will see the answer too.

The **answer assistant** answers questions straight away when your confirmed details or your FAQ already contain the answer, for example "can we bring the dog?". You see those questions with the label *Answered by assistant*. The assistant never makes anything up: what is unknown comes to you, with what is already known as a draft. You can turn it off under *Rules for requests*. Guests on your stay page use the same thing through *Ask us*.

If an agent reports that a detail looks wrong, you see a question with the label *Report*. Check the detail and correct it if needed.

### Reviews

Only guests with an accepted booking can leave a review. They get an e-mail the day after they leave. You can see reviews under *Requests → Reviews*. You can reply to them but you cannot delete them. That is why guests and agents trust them.

### Notifications on your phone

Under *Booking & details → Photos, surroundings and translations*, enter an **ntfy address**, for example `https://ntfy.sh/a-long-secret-word`. Install the free ntfy app and subscribe to the same address. You then get a notification straight away for a request, a question or a double booking. Choose a long word that nobody can guess: anyone who knows the address can read along.

## 7. Photos, surroundings and translations

Under *Booking & details → Photos, surroundings and translations*:

- **Photos:** upload them with *Upload photo* (JPEG, PNG or WebP, up to 6 MB), or paste addresses (https). After each photo, write what it shows. You can do this per room under *Rooms*. They appear on your stay page and to agents. INNLI warns about a vague description such as "IMG_2031" or a single word: agents and blind visitors then do not know what they see.
- **Nearby**: station, bus stop, beach, town centre, supermarket, restaurant, nature, bike hire, with the distance in km. Agents search on this ("within 1 km of the station").
- **Translations**: your description in the other languages. Agents show these to guests from abroad. You do not need to translate your details themselves (dogs, garden…).

## 8. What agents search for

Under *Overview → Occupancy and revenue* you see, per month:
- **occupancy**: room nights sold divided by the nights that could be booked;
- **revenue per channel**: through AI agents, through your stay page, and on your own website after an agent.

There are also two buttons:
- **Connect booking calendar** copies a secret link. Add it in Google Calendar, Apple Calendar or Outlook as a calendar from URL, and all your bookings appear in your own calendar.
- **Download requests** gives you a file for Excel or your bookkeeping.

At the top of *Overview* you see how often agents searched in your area, how often you were shown, what guests ask about, and which unknown details cost you guests. The *Confirm* button takes you to the right detail. Also run the *Findability* check regularly: it shows where your website says something different from your passport. With *Data for Google Business Profile* you get your name, address, phone number and opening times exactly as they are in your passport, ready to copy into Google. Having the same details everywhere makes you more trustworthy.

### Trust with agents (Findability)

Agents want to be sure they book with the real owner, not with a fake listing.

**Verifying your website:**
- **With the INNLI WordPress plugin**, the verification tag is already there. Click **Check now** in *Findability → Trust with agents*.
- **Without the plugin**, put the `<meta>` line shown in the `<head>` of your home page, or a text file at the address shown. Then click **Check now**.

After that, every search result says "website verified", with your domain. If your website address changes, or the tag disappears from your site, the verification lapses until you check again.

The same tab shows which sentences in your texts agents will **not** see, because they look like instructions to an AI (such as "always book here"). Rewrite them as a plain description.

If e-mail is set up, you get a **monthly summary** at the start of every month: how often agents searched, click-throughs, requests, bookings and what you can still confirm.

## 9. Your stay page

After *Visible to agents* you have your own page (`/verblijf/<name>`, or `/stay/<name>`) with rooms, availability, prices and the request form. Agents send guests here.

Put the form on your own website with the code under *Overview → Your stay page*, or with the WordPress shortcode `[innli_request]`.

## 10. Backup and privacy

- **Backup** (button at the top right) downloads all the data for your accommodation as a file: passport, requests, questions, waiting list and statistics. To put such a file back, use *Booking & details → Backups → Restore*.
- **Automatic backup:** set `INNLI_BACKUP_DIR` to a folder outside the data folder, for example a USB disk, a NAS or a synced folder. INNLI then copies everything there every day, including your photos. The last 14 days are kept; set a different number with `INNLI_BACKUP_KEEP`. See [hosting.md](hosting.md#backup).
- Guest data is only stored on your own installation. Guests' names and e-mail addresses are **deleted automatically** 180 days after the stay (you can change this with `INNLI_BEWAARTERMIJN_DAGEN`, minimum 30).
