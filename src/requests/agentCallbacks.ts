import type { Fetcher } from '../connectors/availability.ts';
import type { BookingRequest, Property } from '../domain/types.ts';
import { signRecord } from '../security/signing.ts';
import type { Store } from '../store.ts';
import type { BookingEventType } from './service.ts';

/**
 * Status changes pushed to the agent platform that sent the request (its
 * callbackUrl), so it does not have to poll check_status. Each message is
 * signed with this installation's Ed25519 key, published at
 * /.well-known/innli.json; the platform verifies it like a booking record.
 */
export class AgentCallbacks {
  private store: Store;
  private fetcher: Fetcher;
  private retryDelaysMs: number[];
  private pending = new Set<Promise<void>>();

  constructor(store: Store, fetcher: Fetcher, opts: { retryDelaysMs?: number[] } = {}) {
    this.store = store;
    this.fetcher = fetcher;
    this.retryDelaysMs = opts.retryDelaysMs ?? [10_000, 120_000];
  }

  emit(property: Property, type: BookingEventType, r: BookingRequest): void {
    // The platform created the request itself; it only needs to hear what happens next.
    if (!r.callbackUrl || type === 'request.created') return;
    const event = {
      type,
      at: new Date().toISOString(),
      propertyId: property.id,
      property: property.name,
      requestId: r.id,
      statusToken: r.publicToken,
      status: r.status,
      booked: r.status === 'accepted',
      checkin: r.checkin,
      checkout: r.checkout,
      total: r.quotedTotal,
      currency: property.currency,
      replacesRequestId: r.replacesRequestId,
      hostMessage: r.ownerNote,
    };
    const body = JSON.stringify({ event, signature: signRecord(this.store, event) });
    const job = this.deliver(r.callbackUrl, body).finally(() => this.pending.delete(job));
    this.pending.add(job);
  }

  /** Any other signed event for a platform (e.g. a new offer on a stay wish). */
  send(url: string, event: Record<string, unknown>): void {
    const body = JSON.stringify({ event, signature: signRecord(this.store, event) });
    const job = this.deliver(url, body).finally(() => this.pending.delete(job));
    this.pending.add(job);
  }

  async idle(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  private async deliver(url: string, body: string): Promise<void> {
    for (const delay of [0, ...this.retryDelaysMs]) {
      if (delay) await new Promise((r) => setTimeout(r, delay).unref?.());
      try {
        const res = await this.fetcher(url, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'INNLI-callbacks' }, body, signal: AbortSignal.timeout(10_000), redirect: 'manual' });
        if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) return;
      } catch {
        // retry
      }
    }
  }
}
