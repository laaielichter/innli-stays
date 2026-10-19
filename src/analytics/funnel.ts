import { randomUUID } from 'node:crypto';
import type { AnalyticsEvent, EventType } from '../domain/types.ts';
import type { Store } from '../store.ts';
import { t } from '../i18n/index.ts';

export function track(store: Store, type: EventType, propertyId: string, agentClient?: string, meta?: Record<string, unknown>): void {
  store.addEvent({ id: randomUUID(), type, propertyId, agentClient, at: new Date().toISOString(), meta });
}

export interface Funnel {
  periodDays: number;
  /** Agent requests: the property was considered in answer to a guest question. */
  agentRequests: {
    searchImpressions: number;
    detailViews: number;
    availabilityChecks: number;
    quotes: number;
  };
  bookingLinks: number;
  /** A real person clicked the booking/request link prepared by an agent. */
  clickThroughs: number;
  /** Requests sent through the built-in stay page (by agent guests and direct visitors). */
  bookingRequests: number;
  /** Only counted when the booking system or website reported it back. */
  confirmedBookings: number;
  confirmedRevenue: number;
  byAgent: Record<string, { requests: number; clickThroughs: number; bookings: number }>;
  note: string;
}

/**
 * Agent activity, click-throughs and confirmed bookings are deliberately kept
 * apart: an agent looking at a property is not a guest, and a click is not a booking.
 * Crawler visits are not part of this funnel at all.
 */
export function funnel(store: Store, propertyId: string, days = 30): Funnel {
  const events = store.eventsFor(propertyId, new Date(Date.now() - days * 86_400_000));
  const count = (t: EventType) => events.filter((e) => e.type === t).length;
  const byAgent: Funnel['byAgent'] = {};
  for (const e of events) {
    const name = e.agentClient ?? 'onbekend';
    const row = (byAgent[name] ??= { requests: 0, clickThroughs: 0, bookings: 0 });
    if (e.type === 'click_through') row.clickThroughs++;
    else if (e.type === 'booking_confirmed') row.bookings++;
    else if (e.type !== 'booking_link_created' && e.type !== 'agent_action' && e.type !== 'search_consideration') row.requests++;
  }
  const confirmed = events.filter((e) => e.type === 'booking_confirmed');
  return {
    periodDays: days,
    agentRequests: {
      searchImpressions: count('search_impression'),
      detailViews: count('details_view'),
      availabilityChecks: count('availability_check'),
      quotes: count('quote_issued'),
    },
    bookingLinks: count('booking_link_created'),
    clickThroughs: count('click_through'),
    bookingRequests: count('booking_request'),
    confirmedBookings: confirmed.length,
    confirmedRevenue: Math.round(confirmed.reduce((s, e) => s + (typeof e.meta?.amount === 'number' ? e.meta.amount : 0), 0) * 100) / 100,
    byAgent,
    note: t('own.funnelNote'),
  };
}
