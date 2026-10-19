=== INNLI – AI agent access for your accommodation ===
Tags: bed and breakfast, ai, schema, booking, structured data
Requires at least: 6.0
Requires PHP: 7.4
Stable tag: 2.0.0
License: GPLv2 or later

Connects your B&B website to your INNLI accommodation passport.

== Description ==

* Adds schema.org data, based only on facts you confirmed yourself.
* Shortcode [innli_facts] shows the same facts visibly on your site, so structured data and visible text match. Labels follow the language of your site (English, Dutch, German or French).
* Explicitly allows AI search crawlers (OAI-SearchBot, Claude-SearchBot, PerplexityBot …), separate from the choice to block training crawlers.
* Reports bookings by guests who came through an AI agent back to INNLI with shortcode [innli_conversion] or do_action('innli_report_booking', $booking_number, $amount). No personal data is sent.
* Shortcode [innli_request] puts the request form of your INNLI stay page on your own site, in the language of your site ([innli_aanvraag] keeps working).
* Counts AI crawler visits separately; they never count as guests.
* Proves to AI agents that this website is yours: adds your INNLI verification tag to the home page, so agents see a verified website instead of a possible look-alike.
* English, with a Dutch translation included.

No guarantee of inclusion or ranking: search engines and AI assistants decide for themselves what they show.

== Installation ==

1. In WordPress, go to Plugins → Add New → Upload Plugin and choose the INNLI plugin zip. Activate it.
2. Go to Settings → INNLI and enter the address of your INNLI installation (the address of your INNLI dashboard without /dashboard), your property ID and your secret key. The ID and the key are in the INNLI dashboard under "Booking & details". The page shows straight away whether the connection works, and if not, why.
3. Put [innli_facts] on your home page or a "Practical information" page.
4. Put [innli_conversion] on the confirmation page of your booking system.

== Changelog ==

= 2.0.0 =
* Website verification: the plugin adds INNLI's verification tag to your home page by itself, so AI agents see your website as verified (Dashboard → Trust → Check now).

= 1.1.0 =
* Version aligned with INNLI 1.1.0. No changes to the plugin itself.

= 1.0.1 =
* The INNLI address starts empty instead of a central address; until it is filled in, the dashboard and plugins page show what to do.
* The settings page tests the connection live and says why it fails (address unreachable, unknown property ID, not published).
* The request form grows and shrinks with its content, without an inner scrollbar.
* [innli_facts] gets a tidy two-column layout that follows your theme.
* "Settings" link on the Plugins page; addresses like https://…/dashboard/ are cleaned up automatically.

= 1.0.0 =
* First stable version.
