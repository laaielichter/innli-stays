import { completeness, readFact } from '../domain/facts.ts';
import type { Property } from '../domain/types.ts';
import type { Store } from '../store.ts';
import type { Mailer } from '../requests/mailer.ts';
import { money, ownerLang, t, type Lang } from '../i18n/index.ts';
import { funnel } from './funnel.ts';

/** For agent partners: what each agent sent and what it led to, per property. */
export function agentReport(store: Store, days = 90) {
  const since = new Date(Date.now() - days * 86_400_000);
  const agents: Record<string, { requests: number; quotes: number; clickThroughs: number; bookingRequests: number; bookings: number; revenue: number; properties: Set<string> }> = {};
  for (const p of store.listProperties()) {
    for (const e of store.eventsFor(p.id, since)) {
      if (!e.agentClient || e.agentClient === '__preview__') continue;
      const a = (agents[e.agentClient] ??= { requests: 0, quotes: 0, clickThroughs: 0, bookingRequests: 0, bookings: 0, revenue: 0, properties: new Set() });
      a.properties.add(p.id);
      if (e.type === 'quote_issued') a.quotes++;
      else if (e.type === 'click_through') a.clickThroughs++;
      else if (e.type === 'booking_request') a.bookingRequests++;
      else if (e.type === 'booking_confirmed') {
        a.bookings++;
        a.revenue += typeof e.meta?.amount === 'number' ? e.meta.amount : 0;
      } else if (e.type !== 'agent_action' && e.type !== 'booking_link_created') a.requests++;
    }
  }
  return {
    periodDays: days,
    agents: Object.entries(agents)
      .map(([name, a]) => ({
        agent: name,
        properties: a.properties.size,
        requests: a.requests,
        quotes: a.quotes,
        clickThroughs: a.clickThroughs,
        bookingRequests: a.bookingRequests,
        bookings: a.bookings,
        revenue: Math.round(a.revenue * 100) / 100,
        quoteToBooking: a.quotes ? Math.round((a.bookings / a.quotes) * 1000) / 10 : null,
      }))
      .sort((x, y) => y.bookings - x.bookings || y.requests - x.requests),
  };
}

/** Plain-text monthly summary for the owner, in the owner's language. */
export function monthlyReport(store: Store, property: Property, lang: Lang = ownerLang(property)): string {
  const f = funnel(store, property.id, 30);
  const c = completeness(property, new Date(), lang);
  const requests = f.agentRequests.searchImpressions + f.agentRequests.detailViews + f.agentRequests.availabilityChecks + f.agentRequests.quotes;
  const list = (items: string[]) => `${items.slice(0, 5).join(', ')}${items.length > 5 ? '…' : ''}`;
  return [
    t('rep.title', { property: property.name }, lang),
    '',
    t('rep.agentRequests', { n: requests }, lang),
    t('rep.quotes', { n: f.agentRequests.quotes }, lang),
    t('rep.clicks', { n: f.clickThroughs }, lang),
    t('rep.requests', { n: f.bookingRequests }, lang),
    t('rep.bookings', { n: f.confirmedBookings }, lang) + (f.confirmedRevenue ? ` (${money(f.confirmedRevenue, lang, property.currency)})` : ''),
    '',
    t('rep.passport', { score: c.score }, lang) + (c.unknownCritical.length ? t('rep.unknown', { list: list(c.unknownCritical) }, lang) : ''),
    c.stale.length ? t('rep.recheck', { list: list(c.stale) }, lang) : '',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

/** Confirmed facts formatted for copying into a Google Business Profile (attributes and description). */
export function googleBusinessExport(property: Property, lang: Lang = ownerLang(property)): string {
  const yes = (key: string) => readFact(property.facts, key).status === 'confirmed' && readFact(property.facts, key).value === true;
  const v = (key: string) => (readFact(property.facts, key).status === 'confirmed' ? readFact(property.facts, key).value : null);
  const tr = (key: Parameters<typeof t>[0], value?: unknown) => t(key, { v: value === undefined ? undefined : String(value) }, lang);
  const lines = [
    tr('gbp.name', property.name),
    tr('gbp.category', tr(property.type === 'bnb' || property.type === 'pension' ? 'gbp.bnb' : 'gbp.lodging')),
    tr('gbp.address', [property.address.street, property.address.postalCode, property.address.city].filter(Boolean).join(', ')),
    property.phone ? tr('gbp.phone', property.phone) : '',
    property.website ? tr('gbp.website', property.website) : '',
    '',
    tr('gbp.description'),
    property.description.slice(0, 750),
    '',
    tr('gbp.attributes'),
    yes('pets.dogsAllowed') ? tr('gbp.pets') : '',
    yes('breakfast.included') ? tr('gbp.breakfastIncluded') : yes('breakfast.available') ? tr('gbp.breakfastAvailable') : '',
    yes('parking.onSite') ? tr('gbp.parking') + (yes('parking.free') ? tr('gbp.parkingFree') : '') : '',
    yes('access.stepFreeEntrance') ? tr('gbp.accessible') : '',
    yes('garden.present') ? tr('gbp.garden') : '',
    v('checkin.from') ? tr('gbp.checkin', v('checkin.from')) : '',
    v('checkout.until') ? tr('gbp.checkout', v('checkout.until')) : '',
    '',
    tr('gbp.tip'),
  ];
  return lines.filter((l, i, all) => l !== '' || (all[i - 1] ?? '') !== '').join('\n');
}

/** At the start of each month, each owner gets one summary e-mail. Returns how many were sent. */
export async function sendMonthlyReports(store: Store, mailer: Mailer, now = new Date()): Promise<number> {
  if (now.getUTCDate() > 3) return 0;
  const month = now.toISOString().slice(0, 7);
  const sentFor = { ...(store.getSettings().monthlyReports ?? {}) };
  let sent = 0;
  for (const p of store.listProperties()) {
    if (!p.contactEmail || !p.published || sentFor[p.id] === month) continue;
    await mailer.send({ to: p.contactEmail, subject: t('owner.monthly.subject', { property: p.name }, ownerLang(p)), text: monthlyReport(store, p) });
    sentFor[p.id] = month;
    sent++;
  }
  if (sent) store.updateSettings({ monthlyReports: sentFor });
  return sent;
}
