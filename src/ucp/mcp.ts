import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentContext } from '../requests/agentActions.ts';
import { VERSION } from '../version.ts';
import { UCP_VERSION, UcpOutcome, UcpProtocolError, type UcpLodging } from './lodging.ts';

/**
 * The MCP binding of UCP lodging booking: the same five operations as the REST
 * binding, as tools. Platforms that speak UCP over MCP connect to /ucp/mcp;
 * INNLI's own tools (search, facts, quotes) stay on /mcp.
 *
 * Every call carries `meta["ucp-agent"].profile`; the session travels in
 * `booking`, and an existing session is named by the top-level `id`.
 */

const meta = z
  .object({
    'ucp-agent': z.object({ profile: z.string().url().max(500) }).describe('Your platform profile'),
    'idempotency-key': z.string().max(255).optional().describe('Same key on a retry returns the first result'),
  })
  .passthrough()
  .describe('Protocol metadata, required on every call');
const booking = z.record(z.string(), z.unknown());
const id = z.string().max(120).describe('Id of the booking session');

export const UCP_TOOLS = {
  create_booking_session: {
    title: 'Create booking session',
    description: 'UCP lodging: open a booking session for one property. booking = { property: { id }, stays: [{ accommodation_type: { id }, rate_plan: { id }?, occupancy: { adults, children?, pets? }, stay_dates: { start_date, end_date } }], guests?, booker? }. Returns authoritative totals (minor units), cancellation policy and payment terms, and holds the rooms until expires_at.',
    inputSchema: { meta, booking: booking.describe('The booking session to create') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  get_booking_session: {
    title: 'Get booking session',
    description: 'UCP lodging: the current state of a booking session. After completion: completed (booked), complete_in_progress (the host still decides) or canceled.',
    inputSchema: { meta, id },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  update_booking_session: {
    title: 'Update booking session',
    description: 'UCP lodging: replace the whole booking session (stays, guests, booker). Send every field you want to keep. Only share guest names and e-mail once the buyer agreed.',
    inputSchema: { meta, id, booking: booking.describe('The complete booking session; replaces the stored one') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  complete_booking_session: {
    title: 'Complete booking session',
    description: 'UCP lodging: confirm the booking after the buyer reviewed the totals and terms. No card details: send payment: {} (the guest pays the property). Result: completed, or complete_in_progress while the host decides. Repeating the call never books twice.',
    inputSchema: { meta, id, booking: booking.optional().describe('{ payment: {} }'), payment: booking.optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  cancel_booking_session: {
    title: 'Cancel booking session',
    description: 'UCP lodging: cancel a session and release its rooms. For a confirmed booking this cancels the booking, under the cancellation terms agreed at booking: only when the buyer asked for it.',
    inputSchema: { meta, id, booking: booking.optional() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
};

type Args = { meta: { 'ucp-agent': { profile: string }; 'idempotency-key'?: string }; id?: string; booking?: Record<string, unknown>; payment?: Record<string, unknown> };

const result = (data: unknown, isError = false) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }], structuredContent: data as Record<string, unknown>, isError: isError || undefined });

export function createUcpMcpServer(ucp: UcpLodging, caller: AgentContext, publicUrl: string): McpServer {
  const server = new McpServer({ name: 'innli-ucp', version: VERSION }, { instructions: `UCP lodging booking sessions (capability dev.ucp.lodging.booking, UCP ${UCP_VERSION}, draft). Flow: create_booking_session -> update_booking_session with the booker -> complete_booking_session with payment: {}. Nothing is booked until status is completed. Search, facts and quotes: the INNLI tools at ${publicUrl.replace(/\/$/, '')}/mcp.` });
  /** The platform names itself in meta; without a key or a signature it stays anonymous. */
  const agentOf = (args: Args): AgentContext => {
    if ((caller.identity ?? 'anonymous') !== 'anonymous') return caller;
    let host = 'platform';
    try {
      host = new URL(args.meta['ucp-agent'].profile).host;
    } catch {
      // keep the default
    }
    return { ...caller, name: `${host} (UCP, not verified)`.slice(0, 80) };
  };
  const run = (fn: (args: Args, agent: AgentContext) => Promise<unknown> | unknown) => async (args: Args) => {
    try {
      return result(await fn(args, agentOf(args)));
    } catch (err) {
      // Business outcomes are results with ucp.status "error"; protocol errors are tool errors with a code.
      if (err instanceof UcpOutcome) return result({ ucp: { version: UCP_VERSION, status: 'error' }, messages: [{ type: 'error', code: err.code, content: err.message, severity: err.severity }], continue_url: publicUrl });
      if (err instanceof UcpProtocolError) return result({ code: err.code, content: err.message, status: err.status }, true);
      throw err;
    }
  };
  const need = (value: string | undefined) => {
    if (!value) throw new UcpProtocolError(400, 'invalid_request', 'id is required.');
    return value;
  };
  const tools: Record<keyof typeof UCP_TOOLS, (args: Args, agent: AgentContext) => Promise<unknown> | unknown> = {
    create_booking_session: (args, agent) => ucp.create(args.booking, agent, args.meta['ucp-agent'].profile, args.meta['idempotency-key']),
    get_booking_session: (args) => ucp.get(need(args.id)),
    update_booking_session: (args, agent) => ucp.update(need(args.id), args.booking, agent),
    complete_booking_session: (args, agent) => ucp.complete(need(args.id), { payment: args.booking?.payment ?? args.payment }, agent),
    cancel_booking_session: (args, agent) => ucp.cancel(need(args.id), args.booking, agent),
  };
  for (const name of Object.keys(UCP_TOOLS) as (keyof typeof UCP_TOOLS)[]) server.registerTool(name, UCP_TOOLS[name] as never, run(tools[name]) as never);
  return server;
}
