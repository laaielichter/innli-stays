import { track } from '../analytics/funnel.ts';
import type { Store } from '../store.ts';

export class ConversionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Records a booking the property's own website or booking system reported back.
 * This is the only way a booking enters the funnel as confirmed.
 */
export function recordConversion(store: Store, input: { ref: string; bookingReference: string; amount?: number }, propertyId: string): { recorded: boolean } {
  const link = store.getBookingLink(input.ref);
  if (!link || link.propertyId !== propertyId) throw new ConversionError('Onbekende referentie', 404);
  const duplicate = store.hasEvent(propertyId, (e) => e.type === 'booking_confirmed' && e.meta?.bookingReference === input.bookingReference);
  if (duplicate) return { recorded: false };
  track(store, 'booking_confirmed', propertyId, link.agentClient, { ref: input.ref, bookingReference: input.bookingReference, amount: input.amount, mode: link.mode });
  return { recorded: true };
}
