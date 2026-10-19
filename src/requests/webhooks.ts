import { createHmac, randomUUID } from 'node:crypto';
import type { BookingRequest, Property } from '../domain/types.ts';
import type { Fetcher } from '../connectors/availability.ts';
import type { Store } from '../store.ts';
import type { BookingEventType } from './service.ts';

/** Signature header: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>" with the webhook secret>. */
export const SIGNATURE_HEADER = 'x-innli-signature';

export function signPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

/** The booking as the property's own system needs it, including the guest's contact details. */
export function bookingEvent(property: Property, type: BookingEventType, r: BookingRequest) {
  const unit = property.units.find((u) => u.id === r.unitId);
  return {
    id: `evt_${randomUUID()}`,
    type,
    createdAt: new Date().toISOString(),
    propertyId: property.id,
    data: {
      requestId: r.id,
      status: r.status,
      groupId: r.groupId,
      replacesRequestId: r.replacesRequestId,
      unitId: r.unitId,
      unitRef: unit?.externalRef,
      unitName: unit?.name,
      rooms: r.rooms ?? 1,
      ratePlanId: r.ratePlanId,
      checkin: r.checkin,
      checkout: r.checkout,
      guests: r.guests,
      breakfast: r.breakfast,
      guest: r.guest,
      language: r.language,
      total: r.quotedTotal,
      currency: property.currency,
      priceLines: r.terms?.lines,
      payment: r.payment,
      decidedBy: r.decidedBy,
      cancelReason: r.cancelReason,
      agentClient: r.agentClient,
    },
  };
}

/**
 * Sends booking events to the URL the owner set, signed with their secret.
 * Delivery runs in the background with a few retries; failures are recorded
 * on the property for the dashboard and never affect the booking itself.
 */
export class OutboundWebhooks {
  private store: Store;
  private fetcher: Fetcher;
  private retryDelaysMs: number[];
  private pending = new Set<Promise<void>>();

  constructor(store: Store, fetcher: Fetcher, opts: { retryDelaysMs?: number[] } = {}) {
    this.store = store;
    this.fetcher = fetcher;
    this.retryDelaysMs = opts.retryDelaysMs ?? [5_000, 60_000];
  }

  emit(property: Property, type: BookingEventType, request: BookingRequest): void {
    const hook = property.outboundWebhook;
    if (!hook?.url) return;
    const body = JSON.stringify(bookingEvent(property, type, request));
    const job = this.deliver(property.id, hook.url, hook.secret, body).finally(() => this.pending.delete(job));
    this.pending.add(job);
  }

  /** Sends one test event, waiting for the result (for the dashboard's "test" button). */
  async test(property: Property): Promise<{ ok: boolean; status?: number; error?: string }> {
    const hook = property.outboundWebhook;
    if (!hook?.url) return { ok: false, error: 'no webhook URL' };
    const body = JSON.stringify({ id: `evt_${randomUUID()}`, type: 'test', createdAt: new Date().toISOString(), propertyId: property.id, data: {} });
    return this.attempt(hook.url, hook.secret, body);
  }

  /** Waits until all deliveries in flight are done (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  private async attempt(url: string, secret: string, body: string): Promise<{ ok: boolean; status?: number; error?: string }> {
    try {
      const res = await this.fetcher(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'INNLI-webhooks', [SIGNATURE_HEADER]: signPayload(secret, body) },
        body,
        signal: AbortSignal.timeout(10_000),
        redirect: 'manual',
      });
      return res.ok ? { ok: true, status: res.status } : { ok: false, status: res.status, error: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private async deliver(propertyId: string, url: string, secret: string, body: string): Promise<void> {
    let result = await this.attempt(url, secret, body);
    for (const delay of this.retryDelaysMs) {
      if (result.ok || (result.status && result.status >= 400 && result.status < 500 && result.status !== 429)) break;
      await new Promise((r) => setTimeout(r, delay).unref?.());
      result = await this.attempt(url, secret, body);
    }
    const property = this.store.getProperty(propertyId);
    if (!property?.outboundWebhook) return;
    if (result.ok) {
      property.outboundWebhook.lastDeliveryAt = new Date().toISOString();
      property.outboundWebhook.lastError = undefined;
    } else {
      property.outboundWebhook.lastError = `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC: ${result.error}`;
    }
    this.store.saveProperty(property);
  }
}
