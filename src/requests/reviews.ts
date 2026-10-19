import { REVIEW_ASPECTS, type BookingRequest, type Property, type ReviewAspect } from '../domain/types.ts';
import type { Store } from '../store.ts';
import type { Mailer } from './mailer.ts';
import { defaultLang, t } from '../i18n/index.ts';
import { RequestError } from './service.ts';

/**
 * Reviews from verified stays only: a guest can review once, after a confirmed
 * stay has ended, through the private link in their e-mail. The owner can reply
 * but not delete, so agents can trust what they show.
 */
export class ReviewService {
  private store: Store;
  private mailer: Mailer;
  private publicUrl: string;

  constructor(store: Store, mailer: Mailer, publicUrl: string) {
    this.store = store;
    this.mailer = mailer;
    this.publicUrl = publicUrl.replace(/\/$/, '');
  }

  reviewUrl(r: BookingRequest): string {
    return `${this.publicUrl}/beoordeling/${r.publicToken}`;
  }

  canReview(r: BookingRequest, today = new Date().toISOString().slice(0, 10)): boolean {
    return r.status === 'accepted' && r.checkout <= today && !r.review && !r.anonymisedAt;
  }

  submit(token: string, input: { rating: number; text?: string; aspects?: Partial<Record<string, unknown>> }): BookingRequest {
    const r = this.store.getRequestByToken(token);
    if (!r) throw new RequestError(t('rev.notFound'), 404);
    if (r.review) throw new RequestError(t('rev.already'), 409);
    if (!this.canReview(r)) throw new RequestError(t('rev.notYet'), 409);
    const rating = Math.round(input.rating);
    if (rating < 1 || rating > 5) throw new RequestError(t('rev.stars'));
    // Optional ratings per part of the stay; anything else is ignored.
    const aspects: Partial<Record<ReviewAspect, number>> = {};
    for (const a of REVIEW_ASPECTS) {
      const v = Math.round(Number(input.aspects?.[a]));
      if (v >= 1 && v <= 5) aspects[a] = v;
    }
    r.review = { rating, text: input.text?.trim().slice(0, 1500) || undefined, createdAt: new Date().toISOString(), aspects: Object.keys(aspects).length ? aspects : undefined };
    this.store.saveRequest(r);
    return r;
  }

  reply(property: Property, requestId: string, text: string): BookingRequest {
    const r = this.store.getRequest(requestId);
    if (!r || r.propertyId !== property.id || !r.review) throw new RequestError(t('rev.reviewNotFound'), 404);
    r.review.ownerReply = text.trim().slice(0, 1000) || undefined;
    this.store.saveRequest(r);
    return r;
  }

  /** Summary for agents and the stay page. */
  summary(property: Property) {
    const reviews = this.store
      .requestsFor(property.id)
      .filter((r) => r.review)
      .sort((a, b) => b.review!.createdAt.localeCompare(a.review!.createdAt));
    if (!reviews.length) return { count: 0, verified: true, note: 'No reviews yet. Only guests with a confirmed, completed stay can review.' };
    const average = Math.round((reviews.reduce((s, r) => s + r.review!.rating, 0) / reviews.length) * 10) / 10;
    const aspects: Partial<Record<ReviewAspect, { average: number; count: number }>> = {};
    for (const a of REVIEW_ASPECTS) {
      const scores = reviews.map((r) => r.review!.aspects?.[a]).filter((v): v is number => typeof v === 'number');
      if (scores.length) aspects[a] = { average: Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10, count: scores.length };
    }
    return {
      count: reviews.length,
      average,
      aspects: Object.keys(aspects).length ? aspects : undefined,
      verified: true,
      note: 'Every review comes from a guest with a confirmed, completed stay booked through this property.',
      recent: reviews.slice(0, 5).map((r) => ({ rating: r.review!.rating, aspects: r.review!.aspects, text: r.review!.text, month: r.checkin.slice(0, 7), ownerReply: r.review!.ownerReply })),
    };
  }

  /** Invites guests to review, the day after departure. */
  async invite(now = new Date()): Promise<number> {
    const today = now.toISOString().slice(0, 10);
    let sent = 0;
    for (const r of this.store.allRequests()) {
      if (r.reviewInvitedAt || !this.canReview(r, today) || !r.guest.email) continue;
      const property = this.store.getProperty(r.propertyId);
      if (!property) continue;
      r.reviewInvitedAt = now.toISOString();
      this.store.saveRequest(r);
      sent++;
      await this.mailer.send({
        to: r.guest.email,
        replyTo: property.contactEmail,
        subject: t('mail.review.subject', { property: property.name }, r.language ?? defaultLang()),
        text: t('mail.review.body', { dear: t('mail.dear', { name: r.guest.name }, r.language ?? defaultLang()), property: property.name, url: this.reviewUrl(r), regards: t('mail.regards', {}, r.language ?? defaultLang()) }, r.language ?? defaultLang()),
      });
    }
    return sent;
  }
}
