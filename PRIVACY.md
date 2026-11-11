# Privacy

What personal data INNLI handles, where it is, and who is responsible for it. This is a description of the software, not legal advice.

## Who is responsible

INNLI is software that an accommodation or rental company runs itself. **The owner of an installation is responsible for the personal data on it** (the "controller" under the GDPR). The maker of INNLI:

- does not run the installations,
- receives no data from them: the software does not call home, has no telemetry and needs no account,
- cannot see, change or delete anything on an installation.

An owner who has someone else host the installation (a web developer, a hosting company) needs an agreement with that party, as for any other system with guest data.

## What an installation stores

| Data | Why | Where it comes from |
|---|---|---|
| Name, e-mail address, optional phone number and message of a guest | To handle a booking request | The guest, through an agent or the stay page, after consent |
| Dates, party, room or vehicle, price | The booking itself | The request |
| For camper rental: the driver's age, licence category, years held, country of issue, and the countries the guest wants to drive in | So the company can say yes or no | The guest, through the agent |
| An e-mail address for an answer to a question, or for the waiting list | To send that answer or notice | The guest |
| Which agent sent a request, and how it proved who it is (a key, a verified domain, or not at all) | To settle a dispute, and to limit speculative holds | The connection |
| A shortened hash of the address of an anonymous agent | To limit how many rooms one caller can hold | The connection |
| Statistics per property: counts of searches, views and requests per agent | The owner's overview | The installation itself. No guest is identified in them |

Not stored: card numbers (a payment provider gets a token from the agent platform), passwords of guests (there are none), cookies for tracking, IP addresses in logs or statistics.

Stay wishes are anonymous: hosts see dates, party, wishes and budget, never who the guest is.

## How long

- A guest's name, e-mail address, phone number, message and driver details are **removed automatically** 180 days after the stay ended, or after a request was declined. The owner can set another period with `INNLI_BEWAARTERMIJN_DAGEN` (at least 30 days).
- The same goes for e-mail addresses on questions and on the waiting list.
- Removal covers every copy an installation holds: the request, the quote it came from (with the driver), a checkout or booking session of an agent platform, questions sent with the same e-mail address, and a cancellation reason the guest wrote.
- Removal rewrites the data files, so the details are gone from disk and not only hidden.
- What remains is the booking without the person: dates, room, price. An owner usually needs that for the accounts.
- **Backups** hold a copy. Automatic backups are kept 14 days by default (`INNLI_BACKUP_KEEP`), so removed details can exist in a backup for that long. Backups an owner downloads by hand are the owner's to remove.

## Who receives data

- **The owner and staff** of the property, through the dashboard and by e-mail.
- **The owner's own systems**, when the owner connected them: a booking system, a webhook, an e-mail server.
- **A payment provider**, when the owner set one up: the amount and a payment token, not the guest's details beyond what the provider needs.
- **Agents** receive what they sent themselves and the status of that request.
- **A guide**, when the owner registered with one, forwards agents' calls to the installation. It does not store guests' details.

Nothing is sold, and nothing goes to the maker of INNLI.

## A guest's rights

A guest who wants to see, correct or remove their data asks the owner of the stay or rental company. The owner can:

- see and export requests in the dashboard (*Requests*, and the CSV export),
- decline or cancel a request,
- remove one guest's details at once with *Remove guest's details* on a request that is no longer active (declined, cancelled, or after the stay). A request that is still open, or a booking still to come, has to be declined or cancelled first.

## What an owner should arrange

- A privacy notice for guests. A template is in [docs/legal/guest-privacy-notice.md](docs/legal/guest-privacy-notice.md).
- A secure place for the installation and its backups, and HTTPS in front of it ([docs/hosting.md](docs/hosting.md)).
- An agreement with anyone who hosts or maintains the installation for them.

## The website

The project website sets no cookies and has no analytics or forms. Its fonts are served from the site itself. It is hosted on GitHub Pages; GitHub processes visitors' IP addresses to deliver the pages, under its own privacy statement.
