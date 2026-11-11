/**
 * The in-flight state of a UCP lodging booking session. Kept apart from the
 * booking request it may become: a session is a conversation with a platform,
 * a request is something the host has to answer.
 */
export interface UcpPerson {
  id?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone_number?: string;
}

export interface UcpStayInput {
  id: string;
  unitId: string;
  ratePlanId: string;
  occupancy: { adults: number; children: number; dogs: number };
  /** The occupancy object as the platform sent it, echoed back unchanged. */
  occupancyEcho: Record<string, unknown>;
  guest_assignments?: { guest_id: string; role?: string }[];
}

export interface BookingSessionRecord {
  id: string;
  propertyId: string;
  checkin: string;
  checkout: string;
  stays: UcpStayInput[];
  /** One quote per room type and rate plan; identical rooms share a quote. */
  quotes: { quoteId: string; stayIds: string[] }[];
  guests?: UcpPerson[];
  booker?: UcpPerson & Record<string, unknown>;
  travel_purpose?: string;
  /** Platform that opened the session (UCP-Agent profile). */
  platformProfile: string;
  agentClient: string;
  /** The identified caller that opened the session; only that caller may read or change it. Empty for anonymous callers. */
  owner?: string;
  createdAt: string;
  expiresAt: string;
  /** Set once the session was completed: the booking request it became. */
  statusToken?: string;
  /** Booking link when the property takes bookings in its own system. */
  handoffUrl?: string;
  canceledAt?: string;
  cancelReason?: string;
  /** Total (minor units) the platform last saw, to report a change. */
  lastTotal?: number;
}
