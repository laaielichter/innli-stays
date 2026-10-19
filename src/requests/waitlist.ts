import { randomBytes } from 'node:crypto';
import { CatalogError, normaliseGuests, type Catalog } from '../catalog.ts';
import { stayNights } from '../domain/dates.ts';
import type { Guests, Language, Property, WaitlistEntry } from '../domain/types.ts';
import { defaultLang, formatDate, money, t } from '../i18n/index.ts';
import type { Store } from '../store.ts';
import type { Mailer } from './mailer.ts';

/**
 * Waitlist: when a stay is full, an agent can put the guest on the list for
 * those dates. As soon as a room frees up (cancellation, expired request, the
 * owner opening nights), the guest gets an e-mail with a pre-filled request link.
 */
export class WaitlistService {
  private store: Store;
  private catalog: Catalog;
  private mailer: Mailer;
  private publicUrl: string;

  constructor(store: Store, catalog: Catalog, mailer: Mailer, publicUrl: string) {
    this.store = store;
    this.catalog = catalog;
    this.mailer = mailer;
    this.publicUrl = publicUrl.replace(/\/$/, '');
  }

  join(property: Property, input: { unitId?: string; checkin: string; checkout: string; guests: Partial<Guests>; email: string; language?: Language }, agentClient: string): WaitlistEntry {
    stayNights(input.checkin, input.checkout);
    if (input.checkin <= new Date().toISOString().slice(0, 10)) throw new CatalogError(t('date.mustBeFuture'));
    if (input.unitId && !property.units.some((u) => u.id === input.unitId)) throw new CatalogError(t('cat.unitNotFoundShort', { id: input.unitId }));
    const active = this.store.waitlistFor(property.id).filter((w) => w.status === 'waiting' && w.email === input.email);
    if (active.length >= 3) throw new CatalogError('This guest is already on the waiting list of this property three times.');
    const entry: WaitlistEntry = {
      id: `wl_${randomBytes(5).toString('hex')}`,
      publicToken: randomBytes(16).toString('base64url'),
      propertyId: property.id,
      unitId: input.unitId,
      checkin: input.checkin,
      checkout: input.checkout,
      guests: normaliseGuests(input.guests),
      email: input.email,
      language: input.language ?? property.language ?? defaultLang(),
      agentClient,
      status: 'waiting',
      createdAt: new Date().toISOString(),
    };
    this.store.saveWaitlist(entry);
    return entry;
  }

  status(token: string) {
    const w = this.store.getWaitlistByToken(token);
    if (!w) return null;
    return { type: 'waitlist', status: w.status, propertyId: w.propertyId, unitId: w.unitId, checkin: w.checkin, checkout: w.checkout, notifiedAt: w.notifiedAt, next: w.status === 'notified' ? 'A room became free: the guest received a link to request it. Get a fresh quote and use request_booking.' : w.status === 'waiting' ? 'Still waiting; the guest is e-mailed as soon as a room frees up.' : 'No longer active.' };
  }

  /** Checks every waiting entry; returns how many guests were told a room is free. */
  async check(now = new Date()): Promise<number> {
    const today = now.toISOString().slice(0, 10);
    let notified = 0;
    for (const w of this.store.activeWaitlist()) {
      const property = this.store.getProperty(w.propertyId);
      if (!property || !property.published || w.checkin <= today) {
        w.status = 'expired';
        w.email = '';
        this.store.saveWaitlist(w);
        continue;
      }
      const units = property.units.filter((u) => (!w.unitId || u.id === w.unitId) && u.maxGuests >= w.guests.adults + w.guests.children);
      for (const unit of units) {
        let offer;
        try {
          offer = await this.catalog.offer(property, unit.id, w.checkin, w.checkout, w.guests, false);
        } catch {
          continue;
        }
        if (offer.availability.status !== 'available') continue;
        const link = new URL(`${this.publicUrl}/verblijf/${encodeURIComponent(property.slug)}`);
        const g = w.language ?? defaultLang();
        for (const [k, v] of Object.entries({ unit: unit.id, checkin: w.checkin, checkout: w.checkout, adults: w.guests.adults, children: w.guests.children, dogs: w.guests.dogs, lang: g })) link.searchParams.set(k, String(v));
        await this.mailer.send({
          to: w.email,
          replyTo: property.contactEmail,
          subject: t('mail.waitlist.subject', { property: property.name }, g),
          text: t('mail.waitlist.body', { unit: unit.name, property: property.name, checkin: formatDate(w.checkin, g), checkout: formatDate(w.checkout, g), amount: money(offer.quote.total, g, property.currency), url: `${link.toString()}#aanvragen` }, g),
        });
        w.status = 'notified';
        w.notifiedAt = now.toISOString();
        this.store.saveWaitlist(w);
        notified++;
        break;
      }
    }
    return notified;
  }
}
