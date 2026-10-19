import { UNLIMITED_ROOMS } from './license.ts';

/**
 * The packages INNLI is sold in: one-time prices, no subscription. Used by the
 * seller's licence tool (tools/license.ts).
 * Prices are in euros including VAT where VAT applies; change them here.
 */
export interface Plan {
  id: string;
  name: string;
  /** How many accommodations the installation may list in the INNLI guide. */
  properties: number;
  /** Rooms per accommodation; absent = DEFAULT_MAX_ROOMS (20), UNLIMITED_ROOMS = no limit. */
  maxRooms?: number;
  /** Price to extend updates by a year. */
  renewalPerYear: number;
  /** Years of updates included; the last version in that period keeps working forever. */
  updateYears: number;
  price: number;
  note: string;
}

export const PLANS: Plan[] = [
  { id: 'oprichter', name: 'Oprichter', properties: 1, updateYears: 2, price: 99, renewalPerYear: 49, note: 'Introductieprijs voor de eerste 50 klanten, in ruil voor feedback en een referentie.' },
  { id: 'start', name: 'Start', properties: 1, updateYears: 1, price: 149, renewalPerYear: 49, note: 'Eén B&B of verblijf (tot 20 kamers). De standaard.' },
  { id: 'plus', name: 'Plus', properties: 1, updateYears: 3, price: 249, renewalPerYear: 49, note: 'Eén verblijf, drie jaar updates zonder na te denken.' },
  { id: 'groep', name: 'Groep', properties: 5, updateYears: 1, price: 399, renewalPerYear: 49, note: 'Eén eigenaar met tot vijf verblijven op één installatie.' },
  { id: 'hotel', name: 'Hotel', properties: 1, maxRooms: 150, updateYears: 1, price: 699, renewalPerYear: 149, note: 'Eén hotel tot 150 kamers: kamertypes, tariefplannen, personeel, webhooks naar je PMS.' },
  { id: 'hotelgroep', name: 'Hotelgroep', properties: 5, maxRooms: UNLIMITED_ROOMS, updateYears: 1, price: 1499, renewalPerYear: 349, note: 'Tot vijf hotels, geen kamerlimiet.' },
];

/** Extending updates by one year for the small-accommodation packages; hotel packages have their own renewalPerYear. */
export const RENEWAL_PRICE_PER_YEAR = 49;
/** Optional: installation done for the customer (remote session). */
export const INSTALL_SERVICE_PRICE = 99;
/** Discount for resellers (web builders, booking systems, tourism organisations). */
export const RESELLER_DISCOUNT_PERCENT = 40;

export const planById = (id: string) => PLANS.find((p) => p.id === id);
