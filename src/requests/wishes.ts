import { randomBytes } from 'node:crypto';
import { scanText } from '../agent/hostText.ts';
import { CatalogError, normaliseGuests, type Catalog } from '../catalog.ts';
import { addDays, assertNotInPast, stayNights } from '../domain/dates.ts';
import { impliedRequirements, matchesLocation, matchRoomCombinations, matchUnits, type LocationFilter, type Requirement } from '../domain/matching.ts';
import { isLiveConnector, type BookingRequest, type Currency, type Guests, type Language, type Property, type StayWish, type WishOffer } from '../domain/types.ts';
import { ownerLang, t } from '../i18n/index.ts';
import { rateLimiter } from '../http/safeFetch.ts';
import type { Store } from '../store.ts';
import type { AgentCallbacks } from './agentCallbacks.ts';
import { pushToOwner } from './push.ts';
import { requirementLabel } from '../analytics/insights.ts';
import type { BookingEventType } from './service.ts';

/** A wish lives at most this long, and never past its last possible arrival day. */
export const WISH_MAX_DAYS = 30;
const MAX_OPEN_PER_AGENT = 100;
const MAX_OPEN_TOTAL = 5000;
const MAX_OFFERS_PER_PROPERTY = 3;
const MAX_DISCOUNT = 50;
/** Contact details in a note would make the wish personal data: they are removed. */
const CONTACT = /[\w.+-]+@[\w-]+(\.[\w-]+)+|(\+|00)?\d[\d\s().\/-]{7,}\d|https?:\/\/\S+|www\.\S+/gi;

export interface WishInput {
  area?: string;
  country?: string;
  near?: { lat: number; lng: number; radiusKm: number };
  checkin?: string;
  checkout?: string;
  flexibleDates?: { from: string; to: string; nights?: number; pattern?: 'weekend' | 'long_weekend' | 'midweek' };
  guests?: Partial<Guests>;
  requirements?: string[];
  maxTotalPrice?: number;
  currency?: Currency;
  note?: string;
  language?: Language;
  callbackUrl?: string;
}

const PATTERN_NIGHTS = { weekend: 2, long_weekend: 3, midweek: 4 } as const;

type Json = Record<string, unknown>;

/**
 * Stay wishes: the other direction of search. When nothing fits, an agent
 * leaves what the guest is looking for — without name, e-mail or anything
 * else personal. Stays that already fit answer at once; hosts whose stay
 * could fit see the wish in their dashboard and can answer with an offer
 * (a room, dates and an optional discount just for this guest). The agent
 * collects everything with get_wish_offers and books through the normal
 * consent flow. A host never learns who the guest is until the guest
 * chooses to send a request.
 */
export class WishService {
  private store: Store;
  private catalog: Catalog;
  private callbacks?: AgentCallbacks;
  private limit = rateLimiter(20);

  constructor(store: Store, catalog: Catalog, callbacks?: AgentCallbacks) {
    this.store = store;
    this.catalog = catalog;
    this.callbacks = callbacks;
  }

  // ---------------------------------------------------------------- Agents

  async post(input: WishInput, agentClient: string) {
    if (!this.limit(agentClient)) throw new CatalogError('Too many stay wishes from this agent; try again in a minute.', { code: 'RATE_LIMITED' });
    if (!input.area && !input.country && !input.near) throw new CatalogError('Say where: area, country or near.', { code: 'INVALID_INPUT' });
    if (input.callbackUrl && !(input.callbackUrl.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(input.callbackUrl))) throw new CatalogError('callbackUrl must use https.', { code: 'INVALID_INPUT' });
    const today = new Date().toISOString().slice(0, 10);
    let lastArrival: string;
    if (input.checkin && input.checkout) {
      stayNights(input.checkin, input.checkout, 21);
      assertNotInPast(input.checkin);
      lastArrival = input.checkin;
    } else if (input.flexibleDates) {
      const f = input.flexibleDates;
      const nights = f.pattern ? PATTERN_NIGHTS[f.pattern] : f.nights;
      if (!nights) throw new CatalogError('Give flexibleDates.nights or a pattern.', { code: 'INVALID_INPUT' });
      assertNotInPast(f.from);
      lastArrival = addDays(f.to, -nights);
      if (lastArrival < f.from) throw new CatalogError('The window is shorter than the number of nights.', { code: 'INVALID_INPUT' });
      stayNights(f.from, f.to, 92);
    } else {
      throw new CatalogError('Give checkin and checkout, or flexibleDates: hosts can only offer for known dates.', { code: 'INVALID_INPUT' });
    }
    const open = this.store.listWishes().filter((w) => this.refresh(w).status === 'open');
    if (open.length >= MAX_OPEN_TOTAL || open.filter((w) => w.agentClient === agentClient).length >= MAX_OPEN_PER_AGENT) {
      throw new CatalogError('Too many open stay wishes; withdraw old ones first.', { code: 'LIMIT_REACHED', nextTools: ['withdraw_stay_wish'] });
    }
    const guests = normaliseGuests(input.guests);
    const cap = addDays(today, WISH_MAX_DAYS);
    const note = input.note ? scanText(input.note.replace(CONTACT, '[removed]')).text.slice(0, 500) : undefined;
    const wish: StayWish = {
      id: `wish_${randomBytes(6).toString('hex')}`,
      token: `wt_${randomBytes(18).toString('base64url')}`,
      agentClient,
      area: input.area?.slice(0, 100),
      country: input.country?.toUpperCase().slice(0, 2),
      near: input.near,
      checkin: input.checkin,
      checkout: input.checkout,
      flexibleDates: input.checkin ? undefined : input.flexibleDates,
      guests,
      requirements: impliedRequirements(guests, (input.requirements ?? []) as Requirement[]),
      maxTotalPrice: input.maxTotalPrice,
      currency: input.currency ?? 'EUR',
      note: note || undefined,
      language: input.language,
      callbackUrl: input.callbackUrl,
      status: 'open',
      createdAt: new Date().toISOString(),
      expiresAt: `${lastArrival < cap ? lastArrival : cap}T23:59:59.000Z`,
    };
    this.store.saveWish(wish);
    const fitting = this.store.listProperties().filter((p) => p.published && this.fit(p, wish));
    for (const p of fitting) void this.tellHost(p, wish);
    const offers = await this.matches(wish, agentClient);
    return {
      wishId: wish.id,
      wishToken: wish.token,
      status: wish.status,
      expiresAt: wish.expiresAt,
      hostsThatSeeIt: fitting.length,
      offers,
      privacy: 'No personal data is shared. Hosts see the dates, party, wishes and budget, never who the guest is.',
      next: offers.length
        ? 'Some stays fit already (offers). Hosts can add their own offers until expiresAt: check again with get_wish_offers, or pass callbackUrl to be told.'
        : 'Hosts whose stay could fit now see this wish. Check get_wish_offers later (or pass callbackUrl to be told).',
    };
  }

  async offersFor(token: string, agentClient: string) {
    const wish = this.store.getWishByToken(token);
    if (!wish) throw new CatalogError('Unknown wishToken.', { code: 'NOT_FOUND', nextTools: ['post_stay_wish'] });
    this.refresh(wish);
    const now = new Date().toISOString();
    const hostOffers: Json[] = [];
    if (wish.status === 'open') {
      for (const o of this.store.offersForWish(wish.id)) {
        if (o.status !== 'open' || o.validUntil < now) continue;
        const property = this.store.getProperty(o.propertyId);
        if (!property?.published) continue;
        try {
          // Always a fresh quote: the agent gets today's availability and price, with the host's discount applied.
          const q = (await this.catalog.quote(o.propertyId, o.unitId, o.checkin, o.checkout, wish.guests, false, agentClient, { rooms: o.rooms, discountCode: o.discountCode })) as Json;
          hostOffers.push({
            source: 'host',
            offerId: o.id,
            propertyId: property.id,
            name: property.name,
            location: [property.address.city, property.address.region].filter(Boolean).join(', '),
            unit: property.units.find((u) => u.id === o.unitId)?.name,
            hostMessage: o.message ? scanText(o.message).text : undefined,
            discountPercent: o.discountPercent,
            offerValidUntil: o.validUntil,
            ...pickQuote(q),
          });
        } catch {
          // No longer available or no longer valid: left out rather than shown wrong.
        }
      }
    }
    const matches = wish.status === 'open' ? await this.matches(wish, agentClient) : [];
    // A host's own offer for a stay that also matches stands in for that match.
    const offered = new Set(hostOffers.map((o) => o.propertyId));
    return {
      wishId: wish.id,
      status: wish.status,
      expiresAt: wish.expiresAt,
      offers: [...hostOffers, ...matches.filter((m) => !offered.has(m.propertyId))],
      hostOffers: hostOffers.length,
      next: wish.status !== 'open' ? `This wish is ${wish.status}.` : hostOffers.length ? 'Show the guest the offers with their consent.summary; book one with request_booking({ quoteId, consentHash }).' : 'No host offers yet. Check again later; matching stays are listed as they become available.',
    };
  }

  withdraw(token: string) {
    const wish = this.store.getWishByToken(token);
    if (!wish) throw new CatalogError('Unknown wishToken.', { code: 'NOT_FOUND' });
    if (wish.status === 'open') {
      wish.status = 'withdrawn';
      this.store.saveWish(wish);
      for (const o of this.store.offersForWish(wish.id)) if (o.status === 'open') this.closeOffer(o, 'withdrawn');
    }
    return { wishId: wish.id, status: wish.status };
  }

  /** Stays that fit right now, as offers with a quote. */
  private async matches(wish: StayWish, agentClient: string): Promise<Json[]> {
    try {
      const found = await this.catalog.search(
        { location: this.location(wish), checkin: wish.checkin, checkout: wish.checkout, flexibleDates: wish.flexibleDates, guests: wish.guests, requirements: wish.requirements as Requirement[], maxTotalPrice: wish.maxTotalPrice, currency: wish.maxTotalPrice !== undefined ? wish.currency : undefined, limit: 3, timeBudgetMs: 8000 },
        agentClient,
      );
      return (found.results as Json[])
        .filter((r) => r.offer)
        .map((r) => ({ source: 'match', propertyId: r.propertyId, name: r.name, location: r.location, matchQuality: r.matchQuality, ...pickQuote(r.offer as Json) }));
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------- Hosts

  /** Open wishes this property could answer, with the best room and, for fixed dates, its own price. */
  async forProperty(property: Property) {
    const now = new Date().toISOString();
    const mine = this.store.offersByProperty(property.id);
    const out = [];
    for (const wish of this.store.listWishes().sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))) {
      if (this.refresh(wish).status !== 'open') continue;
      const fit = this.fit(property, wish);
      if (!fit) continue;
      // The dashboard shows the most urgent 50; pricing each one may ask a live booking system.
      if (out.length >= 50) break;
      let price: { total: number; currency: Currency; available: boolean } | undefined;
      if (fit.unitId && wish.checkin && wish.checkout) {
        try {
          const o = await this.catalog.offer(property, fit.unitId, wish.checkin, wish.checkout, wish.guests, false, { rooms: fit.rooms });
          price = { total: o.quote.total, currency: o.quote.currency, available: o.availability.status !== 'unavailable' };
        } catch {
          price = undefined;
        }
      }
      out.push({
        id: wish.id,
        createdAt: wish.createdAt,
        expiresAt: wish.expiresAt,
        agent: wish.agentClient,
        where: wish.area ?? (wish.near ? `${wish.near.radiusKm} km` : wish.country),
        checkin: wish.checkin,
        checkout: wish.checkout,
        flexibleDates: wish.flexibleDates,
        guests: wish.guests,
        requirements: wish.requirements.map((r) => ({ requirement: r, label: requirementLabel(r as Requirement), level: fit.requirements.find((c) => c.requirement === r)?.level })),
        maxTotalPrice: wish.maxTotalPrice,
        currency: wish.currency,
        note: wish.note,
        fit,
        yourPrice: price,
        overBudget: price && wish.maxTotalPrice !== undefined && price.currency === wish.currency ? price.total > wish.maxTotalPrice : undefined,
        offers: mine.filter((o) => o.wishId === wish.id).map((o) => ({ ...o, status: o.status === 'open' && o.validUntil < now ? 'expired' : o.status })),
      });
    }
    return out.sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  }

  async makeOffer(property: Property, wishId: string, input: { unitId: string; checkin?: string; checkout?: string; rooms?: number; discountPercent?: number; message?: string; validDays?: number }, handledBy?: string) {
    const wish = this.store.getWish(wishId);
    if (!wish || this.refresh(wish).status !== 'open') throw new CatalogError(t('wish.notOpen'), { code: 'NOT_FOUND' });
    if (!this.fit(property, wish)) throw new CatalogError(t('wish.noFit'), { code: 'INVALID_INPUT' });
    const checkin = wish.checkin ?? input.checkin;
    const checkout = wish.checkout ?? input.checkout;
    if (!checkin || !checkout) throw new CatalogError(t('wish.chooseDates'), { code: 'INVALID_INPUT' });
    if (wish.flexibleDates && (checkin < wish.flexibleDates.from || checkout > wish.flexibleDates.to)) throw new CatalogError(t('wish.outsideWindow'), { code: 'INVALID_INPUT' });
    const open = this.store.offersForWish(wish.id).filter((o) => o.propertyId === property.id && o.status === 'open');
    if (open.length >= MAX_OFFERS_PER_PROPERTY) throw new CatalogError(t('wish.tooManyOffers', { n: MAX_OFFERS_PER_PROPERTY }), { code: 'LIMIT_REACHED' });
    const percent = Math.round(Math.max(0, Math.min(MAX_DISCOUNT, input.discountPercent ?? 0)));
    // Guests of a live booking system book there; that system does not know INNLI's one-time code.
    if (percent > 0 && isLiveConnector(property.booking.connector) && property.booking.deeplinkTemplate) throw new CatalogError(t('wish.noDiscountOnLink'), { code: 'INVALID_INPUT' });
    const id = `wof_${randomBytes(6).toString('hex')}`;
    const code = percent > 0 ? `OF${randomBytes(5).toString('hex').toUpperCase()}` : undefined;
    if (code) property.offerCodes = [...(property.offerCodes ?? []).filter((c) => c.active), { code, percent, validUntil: checkin, maxUses: 1, active: true, wishOfferId: id }];
    let total: number;
    try {
      const o = await this.catalog.offer(property, input.unitId, checkin, checkout, wish.guests, false, { rooms: input.rooms, discountCode: code });
      if (o.availability.status === 'unavailable') throw new CatalogError(t('cat.unitUnavailable', { unit: o.unit.name }), { code: 'UNAVAILABLE' });
      total = o.quote.total;
    } catch (err) {
      if (code) property.offerCodes = property.offerCodes!.filter((c) => c.code !== code);
      throw err;
    }
    const days = Math.max(1, Math.min(14, input.validDays ?? 7));
    const until = new Date(Date.now() + days * 86_400_000).toISOString();
    const offer: WishOffer = {
      id,
      wishId: wish.id,
      propertyId: property.id,
      unitId: input.unitId,
      checkin,
      checkout,
      rooms: input.rooms && input.rooms > 1 ? input.rooms : undefined,
      discountPercent: percent || undefined,
      discountCode: code,
      message: input.message?.trim().slice(0, 500) || undefined,
      total,
      currency: property.currency,
      status: 'open',
      createdAt: new Date().toISOString(),
      validUntil: until < wish.expiresAt ? until : wish.expiresAt,
      handledBy,
    };
    this.store.saveProperty(property);
    this.store.saveWishOffer(offer);
    if (wish.callbackUrl) {
      this.callbacks?.send(wish.callbackUrl, { type: 'wish.offer', at: offer.createdAt, wishId: wish.id, offerId: offer.id, propertyId: property.id, property: property.name, checkin, checkout, total, currency: offer.currency, validUntil: offer.validUntil, next: 'get_wish_offers with the wishToken' });
    }
    return offer;
  }

  withdrawOffer(property: Property, offerId: string) {
    const o = this.store.getWishOffer(offerId);
    if (!o || o.propertyId !== property.id) throw new CatalogError(t('own.notFound'), { code: 'NOT_FOUND' });
    if (o.status === 'open') this.closeOffer(o, 'withdrawn');
    return o;
  }

  /** Booking events: a request made with an offer's code uses the offer; a confirmed one fulfils the wish. */
  onBookingEvent(property: Property, type: BookingEventType, r: BookingRequest): void {
    const code = r.discountCode ? property.offerCodes?.find((c) => c.code === r.discountCode) : undefined;
    if (!code) return;
    const offer = this.store.getWishOffer(code.wishOfferId);
    if (!offer) return;
    // Instant bookings skip request.created and go straight to booking.confirmed.
    if ((type === 'request.created' || type === 'booking.confirmed') && offer.status === 'open') {
      offer.status = 'requested';
      this.store.saveWishOffer(offer);
    }
    if (type === 'booking.confirmed') {
      const wish = this.store.getWish(offer.wishId);
      if (wish && wish.status === 'open') {
        wish.status = 'booked';
        this.store.saveWish(wish);
      }
    }
  }

  // ---------------------------------------------------------------- Internals

  private location(wish: StayWish): LocationFilter {
    return { area: wish.area, country: wish.country, near: wish.near };
  }

  /** Could this property host this wish? Location and capacity must fit; requirements may still be unknown. */
  private fit(property: Property, wish: StayWish): { unitId?: string; unitName?: string; rooms?: number; matchQuality: string; requirements: { requirement: string; level: string }[] } | null {
    if (!matchesLocation(property, this.location(wish)).ok) return null;
    const reqs = wish.requirements as Requirement[];
    const units = matchUnits(property, reqs, { guests: wish.guests });
    if (units.length) {
      const u = units[0];
      return { unitId: u.unit.id, unitName: u.unit.name, rooms: u.rooms > 1 ? u.rooms : undefined, matchQuality: u.overall, requirements: u.criteria.map((c) => ({ requirement: c.requirement, level: c.level })) };
    }
    const combos = matchRoomCombinations(property, reqs, { guests: wish.guests });
    if (combos.length) return { matchQuality: combos[0].overall, requirements: combos[0].rooms[0].criteria.map((c) => ({ requirement: c.requirement, level: c.level })) };
    return null;
  }

  private refresh(wish: StayWish): StayWish {
    if (wish.status === 'open' && wish.expiresAt < new Date().toISOString()) {
      wish.status = 'expired';
      this.store.saveWish(wish);
      for (const o of this.store.offersForWish(wish.id)) if (o.status === 'open') this.closeOffer(o, 'expired');
    }
    return wish;
  }

  private closeOffer(o: WishOffer, status: 'withdrawn' | 'expired'): void {
    o.status = status;
    this.store.saveWishOffer(o);
    const property = this.store.getProperty(o.propertyId);
    const code = property?.offerCodes?.find((c) => c.wishOfferId === o.id);
    if (property && code) {
      code.active = false;
      this.store.saveProperty(property);
    }
  }

  private async tellHost(property: Property, wish: StayWish): Promise<void> {
    const o = ownerLang(property);
    const party = `${wish.guests.adults + wish.guests.children}${wish.guests.dogs ? ` + ${wish.guests.dogs} 🐕` : ''}`;
    const when = wish.checkin ? `${wish.checkin} – ${wish.checkout}` : `${wish.flexibleDates!.from} – ${wish.flexibleDates!.to}`;
    await pushToOwner(property, t('wish.pushTitle', {}, o), t('wish.pushBody', { when, party }, o));
  }
}

/** The quote fields an agent needs to present and book an offer. */
function pickQuote(q: Json): Json {
  const keys = ['quoteId', 'quoteIds', 'unitId', 'checkin', 'checkout', 'total', 'currency', 'totalIncludesAllMandatoryCosts', 'priceCertainty', 'bookingMode', 'validUntil', 'consent', 'lines', 'cancellationCosts', 'warnings'];
  return Object.fromEntries(keys.filter((k) => q[k] !== undefined).map((k) => [k, q[k]]));
}
