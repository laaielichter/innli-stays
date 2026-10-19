/**
 * Core domain model for the accommodation passport.
 *
 * Every relevant property fact carries its own provenance: what the value is,
 * whether the owner confirmed it, where it came from and when it was last
 * checked. Unknown stays unknown — nothing in INNLI fills gaps by guessing.
 */

export type FactValue = boolean | number | string | string[];

/**
 * - confirmed:   the owner explicitly confirmed this value
 * - unconfirmed: suggested (e.g. extracted from website text), awaiting owner confirmation
 * - unknown:     no reliable information
 */
export type FactStatus = 'confirmed' | 'unconfirmed' | 'unknown';

export type FactSource = 'owner' | 'website' | 'booking_system' | 'import';

export interface Fact {
  value: FactValue | null;
  status: FactStatus;
  source?: FactSource;
  /** Evidence for the value, e.g. a quote from the website or a URL. */
  evidence?: string;
  /** ISO timestamp of the last owner confirmation. */
  verifiedAt?: string;
  updatedAt: string;
}

export type FactMap = Record<string, Fact>;

export type PropertyType = 'bnb' | 'pension' | 'guesthouse' | 'holiday_home' | 'unique_stay' | 'hotel';

export interface Address {
  street?: string;
  postalCode?: string;
  city: string;
  region?: string;
  country: string;
}

export interface Geo {
  lat: number;
  lng: number;
}

/**
 * A rate plan: the standard rate with a percentage on top or off, and its own
 * conditions. Hotels typically offer "flexible", "non-refundable" and
 * "breakfast included".
 */
export interface RatePlan {
  id: string;
  name: string;
  /** Relative to the standard rate: -10 is 10% cheaper, 15 is 15% more. */
  adjustmentPercent: number;
  refundable: boolean;
  breakfastIncluded?: boolean;
  /** Cancellation conditions of this plan; when absent the property's policy applies. */
  cancellation?: string;
}

/** A paid option the owner offers: bikes, a packed lunch, late check-out, a cot. */
export interface Extra {
  id: string;
  name: string;
  description?: string;
  price: number;
  /** How the price counts: once per stay, per night, per person, per person per night, or per room per night. */
  per: 'stay' | 'night' | 'person' | 'person_night' | 'room_night';
  /** Highest quantity a guest can choose (default 1). */
  max?: number;
}

/** A discount code the owner hands out (to returning guests, a newsletter, a partner). Codes are never shown to agents. */
export interface DiscountCode {
  code: string;
  percent: number;
  /** Last arrival date (YYYY-MM-DD) the code is valid for. */
  validUntil?: string;
  minNights?: number;
  /** How often the code may be used (counted over requests that are not declined, expired or cancelled). */
  maxUses?: number;
  active: boolean;
}

/** Charged when a confirmed stay is cancelled fewer than `daysBefore` days before arrival. */
export interface CancellationRule {
  daysBefore: number;
  percent: number;
}

export interface Unit {
  id: string;
  name: string;
  /** Identifier of this unit in the connected booking system. */
  externalRef?: string;
  description?: string;
  maxGuests: number;
  /** Guests included in the base rate. */
  includedGuests: number;
  baseRatePerNight: number;
  extraGuestPerNight?: number;
  /**
   * How many identical rooms of this type exist (default 1). A B&B has rooms of
   * one; a hotel has room types like "Double, 24 rooms".
   */
  inventory?: number;
  /** Nights (YYYY-MM-DD, night starts on that date) the owner closed in INNLI's own room calendar (for a room type: stop-sell). */
  closedNights?: string[];
  rates?: RateTable;
  photos?: Photo[];
  facts: FactMap;
}

/** A photo with a description, so agents (and screen readers) know what it shows. */
export interface Photo {
  url: string;
  caption: string;
}

export const POI_KINDS = ['station', 'bus_stop', 'beach', 'centre', 'supermarket', 'restaurant', 'nature', 'bike_rental', 'other'] as const;
export type PoiKind = (typeof POI_KINDS)[number];

/** A place nearby, as stated by the owner. */
export interface PointOfInterest {
  kind: PoiKind;
  name: string;
  distanceKm: number;
  walkMinutes?: number;
}

export const LANGUAGES = ['nl', 'en', 'de', 'fr'] as const;
/** Currencies a property can price in. INNLI never converts: an agent compares prices within one currency. */
export const CURRENCIES = ['EUR', 'GBP', 'CHF', 'DKK', 'SEK', 'NOK', 'PLN', 'CZK', 'HUF', 'RON', 'ISK', 'USD', 'CAD', 'AUD', 'NZD'] as const;
export type Currency = (typeof CURRENCIES)[number];
const COUNTRY_CURRENCY: Record<string, Currency> = { GB: 'GBP', UK: 'GBP', CH: 'CHF', LI: 'CHF', DK: 'DKK', SE: 'SEK', NO: 'NOK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', IS: 'ISK', US: 'USD', CA: 'CAD', AU: 'AUD', NZ: 'NZD' };
/** Usual currency for a country (ISO 3166 code); EUR when not listed. */
export const currencyForCountry = (country: string | undefined): Currency => COUNTRY_CURRENCY[(country ?? '').toUpperCase()] ?? 'EUR';
export type Language = (typeof LANGUAGES)[number];

/** A recurring yearly period with its own nightly rate, e.g. summer or Christmas. */
export interface Season {
  name: string;
  /** MM-DD, inclusive. A season may wrap the year end (12-20 → 01-05). */
  from: string;
  /** MM-DD, inclusive. */
  to: string;
  ratePerNight: number;
  minNights?: number;
  /** Arrival only on these weekdays in this season (0 = Sunday … 6 = Saturday), e.g. [6] for Saturday to Saturday. */
  checkinDays?: number[];
}

/** The owner's own rate table, used when no live booking system provides rates. */
export interface RateTable {
  seasons: Season[];
  /** Extra per night for Friday and Saturday nights. */
  weekendSupplement?: number;
  discounts?: Discounts;
  /** Arrival only on these weekdays outside seasons that set their own (0 = Sunday … 6 = Saturday). */
  checkinDays?: number[];
  /** Extra charge per room for a stay of exactly one night. */
  singleNightSupplement?: number;
}

/** Owner discounts on the room price. The single best applicable discount is used; they do not stack. */
export interface Discounts {
  /** e.g. [{ minNights: 7, percent: 10 }] */
  longStay?: { minNights: number; percent: number }[];
  /** Arrival within this many days. */
  lastMinute?: { withinDays: number; percent: number };
  /** Booked at least this many days ahead. */
  earlyBird?: { minDaysAhead: number; percent: number };
}

export type ConnectorConfig =
  | { kind: 'none' }
  /** The owner keeps open/closed nights per room in INNLI itself. */
  | { kind: 'manual' }
  /**
   * Calendar exchange (iCal), e.g. Airbnb, Booking.com and Google Calendar feeds.
   * Several feeds per unit. Periodic sync, never treated as live inventory.
   * Older data may hold a single URL string per unit.
   */
  | { kind: 'ical'; calendars: Record<string, string[] | string> }
  /** A booking system with a live availability/rate endpoint (see docs/connector-contract.md). */
  | { kind: 'live_api'; baseUrl: string; apiKey?: string }
  /** Beds24 (API V2): rooms map through externalRef = the Beds24 roomId. */
  | { kind: 'beds24'; refreshToken: string; apiUrl?: string };

/** Connectors that answer live from a booking system (as opposed to synced calendars or the owner's own calendar). */
export const isLiveConnector = (c: ConnectorConfig) => c.kind === 'live_api' || c.kind === 'beds24';

export interface BookingConfig {
  connector: ConnectorConfig;
  /**
   * URL template for the property's own booking environment. Placeholders:
   * {checkin} {checkout} {adults} {children} {dogs} {unit} {ref}
   */
  deeplinkTemplate?: string;
  /** Fallback page where a guest can send an availability request. */
  requestUrl?: string;
}

export interface Property {
  id: string;
  slug: string;
  name: string;
  type: PropertyType;
  description: string;
  address: Address;
  geo?: Geo;
  website?: string;
  contactEmail?: string;
  phone?: string;
  currency: Currency;
  facts: FactMap;
  units: Unit[];
  booking: BookingConfig;
  /** How requests are handled: instant booking, holds, deposits. */
  bookingRules?: BookingRules;
  /** Rate plans next to the standard rate, e.g. non-refundable or breakfast included. */
  ratePlans?: RatePlan[];
  /** Paid options guests can add (bikes, packed lunch, late check-out, cot). */
  extras?: Extra[];
  discountCodes?: DiscountCode[];
  /** One-time codes behind offers on stay wishes; managed by INNLI, not edited in the dashboard. */
  offerCodes?: (DiscountCode & { wishOfferId: string; label?: string })[];
  /** Proof that the owner controls the website named in the passport. */
  websiteVerification?: { token: string; domain?: string; verifiedAt?: string; method?: 'meta' | 'file'; lastCheckedAt?: string; lastError?: string };
  /** Structured cancellation costs, so the cost of cancelling can be calculated. Most strict rule that applies wins. */
  cancellationRules?: CancellationRule[];
  photos?: Photo[];
  pointsOfInterest?: PointOfInterest[];
  /** Language the owner wrote the description (and other free text) in; default nl. */
  language?: Language;
  /** Owner-written descriptions in other languages than `language`. */
  translations?: Partial<Record<Language, { description: string }>>;
  /** Push notifications to the owner's phone via an ntfy topic URL (https://ntfy.sh/<geheim-topic>). */
  notify?: { ntfyUrl?: string };
  published: boolean;
  /** sha256 of the owner API key. */
  ownerKeyHash: string;
  /** Shared secret for signing conversion callbacks from the property's website. */
  webhookSecret: string;
  /** Signed booking events to the property's own system (PMS, channel manager, Zapier/Make). */
  outboundWebhook?: { url: string; secret: string; lastDeliveryAt?: string; lastError?: string };
  /** Staff with their own key: reception handles requests and questions, a manager also edits the property. */
  staff?: StaffMember[];
  lastAudit?: unknown;
  createdAt: string;
  updatedAt: string;
}

export type StaffRole = 'manager' | 'reception';

/** Parts of a stay a guest can rate separately, 1–5. */
export const REVIEW_ASPECTS = ['clean', 'breakfast', 'quiet', 'location', 'value', 'host'] as const;
export type ReviewAspect = (typeof REVIEW_ASPECTS)[number];

export interface StaffMember {
  id: string;
  name: string;
  role: StaffRole;
  /** sha256 of the staff member's key. */
  keyHash: string;
  createdAt: string;
  lastSeenAt?: string;
}

export type AgentScope = 'read' | 'act';

export interface AgentClient {
  id: string;
  name: string;
  keyHash: string;
  /** read = search and quote; act = also send requests, questions and cancellations. Default: both. */
  scopes?: AgentScope[];
  createdAt: string;
  /** Tokens issued through OAuth expire; keys made by the admin do not. */
  expiresAt?: string;
  oauthClientId?: string;
}

export interface DepositRule {
  /** Share of the total to pay in advance, 0–100. */
  percent: number;
  /** Days after confirmation the deposit is due. */
  dueDays: number;
  /** Shown to the guest, e.g. bank account and reference. */
  instructions?: string;
  /** Optional payment link of the owner's own payment provider. */
  paymentUrl?: string;
}

export interface BookingRules {
  /** Confirm requests immediately when the rules below are met (no waiting for the owner). */
  instantBooking: boolean;
  /** Instant booking only this many days or more before arrival. */
  minLeadDays: number;
  /** Instant booking only up to this many nights. */
  maxNights: number;
  /** How long a new request holds the nights before it expires unanswered. */
  holdHours: number;
  deposit?: DepositRule;
  /** Let the answer agent answer guest questions straight away when confirmed facts or the FAQ cover them (default on). */
  autoAnswer?: boolean;
}

export const DEFAULT_BOOKING_RULES: BookingRules = { instantBooking: false, minLeadDays: 2, maxNights: 14, holdHours: 48 };

export interface Guests {
  adults: number;
  children: number;
  dogs: number;
}

export type AvailabilityStatus = 'available' | 'unavailable' | 'unknown';

/**
 * - live:   checked against the booking system at request time
 * - synced: derived from a periodically synced calendar (indicative only)
 * - none:   no connected source
 */
export type Certainty = 'live' | 'synced' | 'none';

export interface NightlyRate {
  date: string;
  amount: number;
}

export interface AvailabilityResult {
  unitId: string;
  status: AvailabilityStatus;
  certainty: Certainty;
  checkedAt: string;
  /** For synced sources: when the underlying calendar was fetched. */
  sourceFetchedAt?: string;
  nightlyRates?: NightlyRate[];
  /** For room types with several rooms: how many are still free on the tightest night. */
  roomsLeft?: number;
  note: string;
}

export type BookingMode = 'booking_link' | 'availability_request';

export interface QuoteLine {
  kind: 'accommodation' | 'discount' | 'code_discount' | 'rate_plan' | 'extra_guest' | 'supplement' | 'extra' | 'fee' | 'tax' | 'breakfast' | 'pet';
  label: string;
  amount: number;
  basis: string;
}

export interface Quote {
  id: string;
  propertyId: string;
  unitId: string;
  checkin: string;
  checkout: string;
  nights: number;
  /** Identical rooms of the unit's type in this quote (default 1). */
  rooms?: number;
  /** Rate plan the price is for (default: the standard rate). */
  ratePlanId?: string;
  /** A short hold on the rooms while the agent asks the guest for consent. */
  hold?: { until: string };
  /** Paid options chosen for this stay. */
  extras?: { id: string; qty: number }[];
  discountCode?: string;
  guests: Guests;
  breakfast: boolean;
  lines: QuoteLine[];
  total: number;
  currency: Currency;
  /** false when a mandatory cost could not be determined. */
  complete: boolean;
  warnings: string[];
  /** Language-independent codes for conditions the stay breaks (min_nights, max_guests, no_dogs, max_dogs, checkin_day). */
  issues?: string[];
  priceCertainty: 'live' | 'indicative';
  availability: AvailabilityResult;
  bookingMode: BookingMode;
  createdAt: string;
  validUntil: string;
}

export interface BookingLink {
  token: string;
  quoteId: string;
  propertyId: string;
  unitId: string;
  targetUrl: string;
  mode: BookingMode;
  agentClient: string;
  createdAt: string;
}

export type EventType =
  | 'search_impression'
  | 'details_view'
  | 'availability_check'
  | 'quote_issued'
  | 'booking_link_created'
  | 'click_through'
  | 'booking_request'
  | 'host_question'
  | 'booking_confirmed'
  /** An agent acted for a guest (request, cancellation, question): the audit trail. */
  | 'agent_action'
  /** A property was evaluated for a search, with the outcome: demand insight for the owner. */
  | 'search_consideration';

/**
 * new: waiting for the owner (nights held until holdUntil)
 * accepted: confirmed booking · declined: refused by the owner
 * expired: not answered in time, hold released · cancelled: withdrawn by guest/agent or owner
 */
export type RequestStatus = 'new' | 'accepted' | 'declined' | 'expired' | 'cancelled';

export interface PaymentState {
  status: 'pending' | 'paid';
  amountDue: number;
  dueDate: string;
  instructions?: string;
  paymentUrl?: string;
  paidAt?: string;
}

/**
 * A booking request sent through the stay page. It is stored only in the
 * owner's own installation and becomes a booking only when the owner accepts.
 */
export interface BookingRequest {
  id: string;
  /** Unguessable token for the guest's status page. */
  publicToken: string;
  propertyId: string;
  unitId: string;
  checkin: string;
  checkout: string;
  guests: Guests;
  breakfast: boolean;
  quotedTotal: number;
  quoteComplete: boolean;
  guest: { name: string; email: string; phone?: string; message?: string };
  /** Identical rooms of this type (default 1). */
  rooms?: number;
  /** Rate plan chosen by the guest. */
  ratePlanId?: string;
  extras?: { id: string; qty: number }[];
  discountCode?: string;
  /** Agent platform URL that receives signed status changes of this request. */
  callbackUrl?: string;
  /** This request changes an earlier booking; accepting it cancels that one. */
  replacesRequestId?: string;
  /** Language for e-mails and pages to the guest. */
  language?: Language;
  status: RequestStatus;
  /** Booking-link reference when the guest came through an AI agent. */
  ref?: string;
  agentClient?: string;
  ownerNote?: string;
  createdAt: string;
  decidedAt?: string;
  /** Set when personal data was removed under the retention policy. */
  anonymisedAt?: string;
  /** Agent-supplied key so a retried request_booking call does not create a duplicate. */
  idempotencyKey?: string;
  /** Rooms booked together as one stay share a group id and are decided together. */
  groupId?: string;
  /** Nights are held for this request until this moment; after that it expires. */
  holdUntil?: string;
  decidedBy?: 'owner' | 'instant' | 'system' | 'guest';
  /** Staff member who accepted or declined (when not the owner). */
  handledBy?: string;
  /** Evidence of who agreed to what, for disputes. */
  consent?: {
    via: 'stay_page' | 'agent';
    agentClient?: string;
    statement: string;
    givenAt: string;
    /** Hash of the terms the guest approved (from get_quote consent.hash), when the agent passed it. */
    termsHash?: string;
    /** The plain-language summary the guest approved. */
    summary?: string;
  };
  /** Price lines and conditions as they were when the guest asked: the booking record. */
  terms?: { lines: QuoteLine[]; policies: Record<string, unknown>; capturedAt: string };
  payment?: PaymentState;
  cancelledAt?: string;
  cancelReason?: string;
  ownerRemindedAt?: string;
  preArrivalSentAt?: string;
  conflictNotifiedAt?: string;
  reviewInvitedAt?: string;
  /** Review by the guest after the stay: only possible for a confirmed, completed stay. */
  review?: { rating: number; text?: string; createdAt: string; ownerReply?: string; aspects?: Partial<Record<ReviewAspect, number>> };
}

/**
 * A stay wish: what a guest is looking for, posted by their agent without any
 * personal data. Matching stays answer at once; hosts whose stay fits can
 * answer with an offer of their own until the wish expires.
 */
export interface StayWish {
  id: string;
  /** Secret for the agent that posted the wish (get_wish_offers, withdraw). */
  token: string;
  agentClient: string;
  area?: string;
  country?: string;
  near?: { lat: number; lng: number; radiusKm: number };
  checkin?: string;
  checkout?: string;
  flexibleDates?: { from: string; to: string; nights?: number; pattern?: 'weekend' | 'long_weekend' | 'midweek' };
  guests: Guests;
  /** Requirement codes from domain/matching.ts. */
  requirements: string[];
  maxTotalPrice?: number;
  currency: Currency;
  /** Free text from the guest, without contact details, cleaned of instruction-like text. */
  note?: string;
  language?: Language;
  callbackUrl?: string;
  status: 'open' | 'withdrawn' | 'expired' | 'booked';
  createdAt: string;
  expiresAt: string;
}

/** A host's answer to a stay wish: a room, dates and optionally a discount just for this guest. */
export interface WishOffer {
  id: string;
  wishId: string;
  propertyId: string;
  unitId: string;
  checkin: string;
  checkout: string;
  rooms?: number;
  /** Discount on the room price for this offer only, as a one-time code. */
  discountPercent?: number;
  discountCode?: string;
  message?: string;
  /** Price when the offer was made (the agent always gets a fresh quote). */
  total: number;
  currency: Currency;
  status: 'open' | 'withdrawn' | 'expired' | 'requested';
  createdAt: string;
  validUntil: string;
  handledBy?: string;
}

/** A guest waiting for a room to become free on specific dates. */
export interface WaitlistEntry {
  id: string;
  publicToken: string;
  /** Language for the e-mail to the guest. */
  language?: Language;
  propertyId: string;
  unitId?: string;
  checkin: string;
  checkout: string;
  guests: Guests;
  email: string;
  agentClient: string;
  status: 'waiting' | 'notified' | 'expired' | 'cancelled';
  createdAt: string;
  notifiedAt?: string;
}

/**
 * A question an agent asks the host on a guest's behalf, typically about a fact
 * that is unknown in the passport. The answer can be stored as a confirmed fact.
 */
export interface HostQuestion {
  id: string;
  publicToken: string;
  /** Language for the answer e-mail to the guest. */
  language?: Language;
  propertyId: string;
  question: string;
  /** Passport fact the question is about, if any (e.g. garden.fullyEnclosed). */
  factKey?: string;
  unitId?: string;
  /** Only with the guest's consent: where the host's answer is e-mailed. */
  replyEmail?: string;
  agentClient: string;
  status: 'open' | 'answered';
  answer?: string;
  /** Who answered: the owner, or the answer agent from confirmed facts / the FAQ. */
  answeredBy?: 'owner' | 'assistant';
  /** What the answer agent already knows, as a starting point for the owner's answer. */
  draft?: string;
  /** A question, or a report that a fact may be wrong (from report_data_issue). */
  kind?: 'question' | 'issue';
  /** Owner chose to show this question and answer to all agents (FAQ). */
  publishAsFaq?: boolean;
  createdAt: string;
  answeredAt?: string;
  anonymisedAt?: string;
}

export interface AnalyticsEvent {
  id: string;
  type: EventType;
  propertyId: string;
  agentClient?: string;
  at: string;
  meta?: Record<string, unknown>;
}
