/**
 * Machine-readable errors for agents. A readable message alone forces an agent
 * to guess whether to retry, ask the guest or call another tool; a code, a
 * retry flag and the tools that help next make that a lookup instead.
 */
export const ERROR_CODES = [
  'INVALID_INPUT',
  'NOT_FOUND',
  'QUOTE_NOT_FOUND',
  'QUOTE_EXPIRED',
  'UNAVAILABLE',
  'CONSENT_REQUIRED',
  'TERMS_CHANGED',
  'FORBIDDEN',
  'AGENT_IDENTITY_REQUIRED',
  'RATE_LIMITED',
  'CONFLICT',
  'LIMIT_REACHED',
  'DRIVER_NOT_ELIGIBLE',
  'UPSTREAM_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorDetails {
  code?: ErrorCode;
  retryable?: boolean;
  retryAfterSeconds?: number;
  hint?: string;
  nextTools?: string[];
}

/** Defaults per code, so most throw sites only name the code. */
const DEFAULTS: Record<ErrorCode, { retryable: boolean; nextTools?: string[]; hint?: string }> = {
  INVALID_INPUT: { retryable: false, hint: 'Fix the arguments named in the message and call the tool again.' },
  NOT_FOUND: { retryable: false, nextTools: ['search_stays'], hint: 'Use an id from search_stays or get_stay_details.' },
  QUOTE_NOT_FOUND: { retryable: true, nextTools: ['get_quote'], hint: 'Get a quote first, then use its quoteId.' },
  QUOTE_EXPIRED: { retryable: true, nextTools: ['get_quote'], hint: 'Get a fresh quote and show the guest the current price before continuing.' },
  UNAVAILABLE: { retryable: false, nextTools: ['find_available_dates', 'search_stays', 'join_waitlist', 'post_stay_wish'], hint: 'Offer other dates, another room or a similar stay; or leave a stay wish so hosts can make an offer.' },
  CONSENT_REQUIRED: { retryable: false, hint: 'Ask the guest explicitly and only then call again with guestConsent: true.' },
  TERMS_CHANGED: { retryable: true, nextTools: ['get_quote'], hint: 'The terms the guest agreed to no longer match. Show the guest the new consent.summary and ask again.' },
  FORBIDDEN: { retryable: false, hint: 'This agent key may not do this. Connect with an agent key that has the act scope.' },
  AGENT_IDENTITY_REQUIRED: { retryable: false, nextTools: ['prepare_booking'], hint: 'This host only takes requests from agents that prove who they are: sign requests with Web Bot Auth (RFC 9421, see /.well-known/agent-card.json) or connect through OAuth. Without that, give the guest the link from prepare_booking.' },
  RATE_LIMITED: { retryable: true, hint: 'Wait retryAfterSeconds before trying again; do not retry in a loop.' },
  CONFLICT: { retryable: false, nextTools: ['check_status'], hint: 'The request changed meanwhile; check_status shows its current state.' },
  LIMIT_REACHED: { retryable: false, nextTools: ['check_status', 'cancel_request'], hint: 'Too many open requests are holding rooms. Wait for the host to answer, or withdraw one the guest no longer wants.' },
  DRIVER_NOT_ELIGIBLE: { retryable: false, nextTools: ['search_stays', 'ask_host'], hint: 'This driver or party does not meet the rental rules in the message. Offer another vehicle (search_stays with kind: "camper"), another driver, or ask the company; never change the driver details to make it fit.' },
  UPSTREAM_ERROR: { retryable: true, hint: "The property's booking system did not answer; try again later or use the indicative data." },
};

export class AgentError extends Error {
  code: ErrorCode;
  retryable: boolean;
  retryAfterSeconds?: number;
  hint?: string;
  nextTools?: string[];

  constructor(message: string, details: ErrorDetails = {}) {
    super(message);
    this.code = details.code ?? 'INVALID_INPUT';
    const d = DEFAULTS[this.code];
    this.retryable = details.retryable ?? d.retryable;
    this.retryAfterSeconds = details.retryAfterSeconds ?? (this.code === 'RATE_LIMITED' ? 60 : undefined);
    this.hint = details.hint ?? d.hint;
    this.nextTools = details.nextTools ?? d.nextTools;
  }

  toJSON() {
    return { code: this.code, message: this.message, retryable: this.retryable, retryAfterSeconds: this.retryAfterSeconds, hint: this.hint, nextTools: this.nextTools };
  }
}

export type AgentErrorBody = ReturnType<AgentError['toJSON']>;

/** The same shape for any error an agent can get, e.g. a rate limit before any tool runs. */
export function errorBody(message: string, details: ErrorDetails = {}): AgentErrorBody {
  return new AgentError(message, details).toJSON();
}
