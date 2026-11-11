import type { Fetcher } from '../connectors/availability.ts';

/**
 * Card payments by agents, without INNLI ever holding money or card data.
 *
 * An agent platform gives the property a single-use payment token for one
 * purchase (ACP "delegated payment"). The property's own payment provider
 * turns that token into an authorisation on the property's own account:
 *
 *   authorise  when the guest's agent completes the checkout (nothing is taken yet)
 *   capture    when the host confirms, or at once with instant booking
 *   release    when the host declines, the request expires or it is withdrawn
 *
 * So a guest never pays for a stay the host did not confirm, and a host gets
 * a guaranteed payment instead of a promise. The property is the merchant of
 * record; the token never touches INNLI's own storage.
 */
export interface CardAuthorization {
  provider: string;
  /** The provider's reference (e.g. a Stripe PaymentIntent id). */
  reference: string;
  /** Minor units. */
  amount: number;
  currency: string;
  status: 'authorized' | 'captured' | 'released' | 'failed';
  authorizedAt: string;
  settledAt?: string;
  error?: string;
}

export class PaymentError extends Error {
  code: string;
  constructor(message: string, code = 'payment_declined') {
    super(message);
    this.code = code;
  }
}

export interface PaymentHandler {
  /** Handler id agents refer to in `payment_data.handler_id`. */
  id: string;
  /** How the handler is described to agents (ACP PaymentHandler object). */
  descriptor(): Record<string, unknown>;
  authorize(input: { token: string; amount: number; currency: string; description: string; idempotencyKey: string; metadata: Record<string, string> }): Promise<CardAuthorization>;
  capture(auth: CardAuthorization, idempotencyKey: string): Promise<void>;
  release(auth: CardAuthorization, idempotencyKey: string): Promise<void>;
}

/**
 * Stripe, with the property's own secret key (INNLI_STRIPE_SECRET_KEY). The
 * token is a Stripe shared payment token an agent platform was granted for
 * this purchase. EXPERIMENTAL: written against Stripe's published API for
 * agentic commerce and tested against a stand-in; verify with a Stripe test
 * key before taking real payments.
 */
export class StripeHandler implements PaymentHandler {
  id = 'card_tokenized';
  private key: string;
  private account?: string;
  private fetcher: Fetcher;
  private base: string;

  constructor(opts: { secretKey: string; account?: string; fetcher: Fetcher; apiBase?: string }) {
    this.key = opts.secretKey;
    this.account = opts.account;
    this.fetcher = opts.fetcher;
    this.base = (opts.apiBase ?? 'https://api.stripe.com').replace(/\/$/, '');
  }

  descriptor() {
    return {
      id: this.id,
      name: 'dev.acp.tokenized.card',
      version: '2026-01-22',
      spec: 'https://acp.dev/handlers/tokenized.card',
      requires_delegate_payment: true,
      requires_pci_compliance: false,
      psp: 'stripe',
      config_schema: 'https://acp.dev/schemas/handlers/tokenized.card/config.json',
      instrument_schemas: ['https://acp.dev/schemas/handlers/tokenized.card/instrument.json'],
      config: { merchant_id: this.account, psp: 'stripe', accepted_brands: ['visa', 'mastercard', 'amex'], supports_3ds: false, environment: this.key.startsWith('sk_live') ? 'production' : 'test' },
    };
  }

  private async call(path: string, params: Record<string, string>, idempotencyKey: string): Promise<Record<string, any>> {
    let res: Response;
    try {
      res = await this.fetcher(`${this.base}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': idempotencyKey },
        body: new URLSearchParams(params).toString(),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new PaymentError('The payment provider did not answer.', 'payment_provider_unavailable');
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) throw new PaymentError(String(body.error?.message ?? `Payment provider answered ${res.status}`).slice(0, 300), body.error?.code === 'card_declined' || res.status === 402 ? 'payment_declined' : 'payment_failed');
    return body;
  }

  async authorize(input: { token: string; amount: number; currency: string; description: string; idempotencyKey: string; metadata: Record<string, string> }): Promise<CardAuthorization> {
    const params: Record<string, string> = {
      amount: String(input.amount),
      currency: input.currency.toLowerCase(),
      // Authorise only: the money is taken when the host confirms.
      capture_method: 'manual',
      confirm: 'true',
      shared_payment_granted_token: input.token,
      description: input.description.slice(0, 500),
    };
    for (const [k, v] of Object.entries(input.metadata)) params[`metadata[${k}]`] = v.slice(0, 400);
    const intent = await this.call('/v1/payment_intents', params, input.idempotencyKey);
    if (intent.status !== 'requires_capture') throw new PaymentError(`The card could not be authorised (${String(intent.status)}).`, intent.status === 'requires_action' ? 'requires_3ds' : 'payment_declined');
    return { provider: 'stripe', reference: String(intent.id), amount: input.amount, currency: input.currency, status: 'authorized', authorizedAt: new Date().toISOString() };
  }

  async capture(auth: CardAuthorization, idempotencyKey: string): Promise<void> {
    await this.call(`/v1/payment_intents/${encodeURIComponent(auth.reference)}/capture`, {}, idempotencyKey);
  }

  async release(auth: CardAuthorization, idempotencyKey: string): Promise<void> {
    await this.call(`/v1/payment_intents/${encodeURIComponent(auth.reference)}/cancel`, { cancellation_reason: 'abandoned' }, idempotencyKey);
  }
}
