/** The in-flight state of an ACP checkout session: one or more quoted stays at one property. */
export interface AcpBuyer {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone_number?: string;
}

export interface CheckoutSessionRecord {
  id: string;
  propertyId: string;
  /** What the platform asked for, echoed back. */
  items: { id: string; quantity: number }[];
  /** One held quote per item. */
  quoteIds: string[];
  buyer?: AcpBuyer;
  fulfillment_details?: Record<string, unknown>;
  agentClient: string;
  /** The identified caller that opened the session; only that caller may read or change it. */
  owner?: string;
  createdAt: string;
  expiresAt: string;
  /** Set once completed: the booking request it became. */
  statusToken?: string;
  /** Booking link when the property takes bookings in its own system. */
  handoffUrl?: string;
  canceledAt?: string;
}
