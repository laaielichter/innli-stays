import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ErrorDetails } from '../agentErrors.ts';
import { nextActions } from '../agent/shape.ts';
import { CORE_INSTRUCTIONS, CORE_TOOLS, INSTRUCTIONS, ok, toolError, TOOLS, type ToolProfile } from '../mcp/server.ts';
import { VERSION } from '../version.ts';
import type { Guide, Listing } from './guide.ts';
import { GUIDE_AGENT_HEADER } from './types.ts';

const MAX_FANOUT = 15;
const CALL_TIMEOUT_MS = 10_000;
const SEP = ':';

type Json = Record<string, unknown>;

/** An error from an installation (or the guide itself), keeping the installation's code and hint. */
class RemoteError extends Error {
  details: ErrorDetails;
  constructor(message: string, details: ErrorDetails = {}) {
    super(message);
    this.details = details;
  }
}

const remoteFailure = (err: unknown) =>
  err instanceof RemoteError ? toolError(err.message, err.details) : toolError(`Accommodatie niet bereikbaar (${(err as Error).message})`, { code: 'UPSTREAM_ERROR' });

/** Calls one tool on a self-hosted installation over MCP. */
async function callInstance(listing: Listing, tool: string, args: Json, agentName: string): Promise<Json> {
  const client = new Client({ name: 'innli-gids', version: VERSION });
  const transport = new StreamableHTTPClientTransport(new URL(`${listing.instanceUrl}/mcp`), {
    requestInit: { headers: { [GUIDE_AGENT_HEADER]: `${agentName} via INNLI-gids` } },
  });
  try {
    await client.connect(transport);
    const res = (await client.callTool({ name: tool, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS })) as {
      isError?: boolean;
      content?: { type: string; text?: string }[];
      structuredContent?: Json;
    };
    if (res.isError) {
      const e = (res.structuredContent as { error?: ErrorDetails & { message?: string } } | undefined)?.error;
      throw new RemoteError(e?.message ?? res.content?.find((c) => c.type === 'text')?.text ?? 'Fout bij accommodatie', e ?? {});
    }
    if (!res.structuredContent) throw new RemoteError('Empty response from the property');
    return res.structuredContent;
  } finally {
    await client.close().catch(() => {});
  }
}

/** Ids from an installation get its instance id as prefix, so the guide can route follow-up calls. */
function prefixIds<T>(value: T, instanceId: string): T {
  if (Array.isArray(value)) return value.map((v) => prefixIds(v, instanceId)) as T;
  if (value && typeof value === 'object') {
    const out: Json = {};
    for (const [k, v] of Object.entries(value)) {
      if ((k === 'propertyId' || k === 'quoteId' || k === 'statusToken') && typeof v === 'string') out[k] = `${instanceId}${SEP}${v}`;
      else if ((k === 'quoteIds' || k === 'propertyIds') && Array.isArray(v)) out[k] = v.map((x) => (typeof x === 'string' ? `${instanceId}${SEP}${x}` : x));
      else out[k] = prefixIds(v, instanceId);
    }
    return out as T;
  }
  return value;
}

type IdKey = 'propertyId' | 'quoteId' | 'statusToken';

function route(guide: Guide, id: string, kind: IdKey): { listing: Listing; localId: string } {
  const idx = id.indexOf(SEP);
  const listing = idx > 0 ? guide.get(id.slice(0, idx)) : undefined;
  const localId = id.slice(idx + 1);
  // Only stays that are listed (within the licence) can be reached through the guide.
  if (!listing || (kind === 'propertyId' && !listing.properties.some((p) => p.id === localId))) {
    throw new RemoteError(`Onbekende of niet meer beschikbare accommodatie: ${id}`, { code: 'NOT_FOUND' });
  }
  return { listing, localId };
}

const QUALITY = ['met', 'unverified', 'unknown'];

/** One token for a wish spread over several installations: their own tokens, encoded (each is a secret already). */
function wishTokenOf(parts: [string, string][]): string {
  return `gw.${Buffer.from(JSON.stringify(parts)).toString('base64url')}`;
}

function partsOf(token: string): [string, string][] | null {
  if (!token.startsWith('gw.')) return null;
  try {
    const parts = JSON.parse(Buffer.from(token.slice(3), 'base64url').toString('utf8'));
    return Array.isArray(parts) && parts.every((p) => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === 'string')) ? parts.slice(0, MAX_FANOUT) : null;
  } catch {
    return null;
  }
}

/** Only stays the installation listed (within its licence) are shown through the guide. */
function listedOnly(l: Listing, offers: Json[]): Json[] {
  const listed = new Set(l.properties.map((p) => `${l.instanceId}${SEP}${p.id}`));
  return offers.filter((o) => listed.has(String(o.propertyId)));
}

/**
 * MCP server of the INNLI guide. Same tools as a single installation, so agents
 * need only one connection; every call is answered live by the installation
 * that owns the stay.
 */
export function createGuideMcpServer(guide: Guide, agentName: string, profile: ToolProfile = 'full'): McpServer {
  const server = new McpServer({ name: 'innli-gids', version: VERSION }, { instructions: profile === 'core' ? CORE_INSTRUCTIONS : INSTRUCTIONS });
  // The core profile offers only the core tools (see mcp/server.ts); installations answer briefly on their own.
  if (profile === 'core') {
    const register = server.registerTool.bind(server) as (...a: unknown[]) => unknown;
    (server as unknown as { registerTool: (...a: unknown[]) => unknown }).registerTool = (name: unknown, ...rest: unknown[]) => (CORE_TOOLS.includes(name as never) ? register(name, ...rest) : undefined);
  }

  const forward = (tool: string, idKey: IdKey) => async (args: Json) => {
    try {
      const { listing, localId } = route(guide, String(args[idKey]), idKey);
      return ok(prefixIds(await callInstance(listing, tool, { ...args, [idKey]: localId }, agentName), listing.instanceId));
    } catch (err) {
      return remoteFailure(err);
    }
  };

  server.registerTool('search_stays', TOOLS.search_stays, async (args) => {
    const candidates = guide.candidates({ area: args.area, country: args.country, near: args.near }).slice(0, MAX_FANOUT);
    const settled = await Promise.allSettled(
      candidates.map(async (l) => {
        const r = await callInstance(l, 'search_stays', args as Json, agentName);
        const listed = new Set(l.properties.map((p) => p.id));
        const listedNames = new Set(l.properties.map((p) => p.name));
        return prefixIds<Json>(
          {
            ...r,
            results: ((r.results as Json[]) ?? []).filter((x) => listed.has(String(x.propertyId))),
            excluded: ((r.excluded as Json[]) ?? []).filter((x) => listedNames.has(String(x.property))),
          },
          l.instanceId,
        );
      }),
    );
    const results: Json[] = [];
    const excluded: Json[] = [];
    let first: Json | undefined;
    let unreachable = 0;
    for (const s of settled) {
      if (s.status === 'rejected') {
        unreachable++;
        continue;
      }
      first ??= s.value;
      results.push(...((s.value.results as Json[]) ?? []));
      excluded.push(...((s.value.excluded as Json[]) ?? []));
    }
    const total = (r: Json) => ((r.offer as Json | null)?.total as number | undefined) ?? Number.MAX_SAFE_INTEGER;
    const currency = (r: Json) => (r.offer as Json | null)?.currency;
    // Totals are only comparable within one currency; INNLI never converts.
    results.sort((a, b) => QUALITY.indexOf(String(a.matchQuality)) - QUALITY.indexOf(String(b.matchQuality)) || (currency(a) === currency(b) ? total(a) - total(b) : 0));
    const merged: Json = {
      query: first?.query,
      results: results.slice(0, args.limit ?? 5),
      excluded,
      installationsAsked: candidates.length,
      installationsUnreachable: unreachable,
      legend: first?.legend,
      guidance: first?.guidance,
    };
    const actions = nextActions('search_stays', args as Json, merged);
    return ok({ ...merged, nextActions: actions.length ? actions : undefined, freshness: first?.freshness });
  });
  server.registerTool('get_stay_details', TOOLS.get_stay_details, forward('get_stay_details', 'propertyId'));
  server.registerTool('check_availability', TOOLS.check_availability, forward('check_availability', 'propertyId'));
  server.registerTool('get_quote', TOOLS.get_quote, forward('get_quote', 'propertyId'));
  server.registerTool('prepare_booking', TOOLS.prepare_booking, forward('prepare_booking', 'quoteId'));
  server.registerTool('find_available_dates', TOOLS.find_available_dates, forward('find_available_dates', 'propertyId'));
  server.registerTool('get_availability_calendar', TOOLS.get_availability_calendar, forward('get_availability_calendar', 'propertyId'));
  server.registerTool('request_booking', TOOLS.request_booking, async (args) => {
    if (!args.quoteIds?.length) return forward('request_booking', 'quoteId')(args as Json);
    try {
      const routed = args.quoteIds.map((id) => route(guide, id, 'quoteId'));
      if (new Set(routed.map((r) => r.listing.instanceId)).size > 1) throw new RemoteError('All rooms of a group must be in the same property.', { code: 'INVALID_INPUT' });
      const res = await callInstance(routed[0].listing, 'request_booking', { ...args, quoteIds: routed.map((r) => r.localId) }, agentName);
      return ok(prefixIds(res, routed[0].listing.instanceId));
    } catch (err) {
      return remoteFailure(err);
    }
  });
  server.registerTool('ask_host', TOOLS.ask_host, forward('ask_host', 'propertyId'));
  server.registerTool('answer_question', TOOLS.answer_question, forward('answer_question', 'propertyId'));
  server.registerTool('modify_request', TOOLS.modify_request, forward('modify_request', 'statusToken'));
  server.registerTool('report_data_issue', TOOLS.report_data_issue, forward('report_data_issue', 'propertyId'));
  server.registerTool('check_status', TOOLS.check_status, forward('check_status', 'statusToken'));
  server.registerTool('cancel_request', TOOLS.cancel_request, forward('cancel_request', 'statusToken'));
  server.registerTool('join_waitlist', TOOLS.join_waitlist, forward('join_waitlist', 'propertyId'));

  // Stay wishes go to every installation in the area; one combined token collects the offers again.
  server.registerTool('post_stay_wish', TOOLS.post_stay_wish, async (args) => {
    const candidates = guide.candidates({ area: args.area, country: args.country, near: args.near }).slice(0, MAX_FANOUT);
    if (!candidates.length) return toolError('No listed installations in this area yet.', { code: 'NOT_FOUND', hint: 'Try a wider area or only the country.' });
    const settled = await Promise.allSettled(candidates.map(async (l) => ({ l, r: await callInstance(l, 'post_stay_wish', args as Json, agentName) })));
    const parts: [string, string][] = [];
    const offers: Json[] = [];
    let hosts = 0;
    let first: Json | undefined;
    let failure: unknown;
    for (const s of settled) {
      if (s.status === 'rejected') {
        failure ??= s.reason;
        continue;
      }
      const { l, r } = s.value;
      first ??= r;
      parts.push([l.instanceId, String(r.wishToken)]);
      hosts += Number(r.hostsThatSeeIt ?? 0);
      offers.push(...listedOnly(l, prefixIds((r.offers as Json[]) ?? [], l.instanceId)));
    }
    if (!parts.length) return remoteFailure(failure);
    const result: Json = { wishToken: wishTokenOf(parts), status: 'open', expiresAt: first?.expiresAt, hostsThatSeeIt: hosts, installations: parts.length, offers, privacy: first?.privacy, next: first?.next };
    return ok({ ...result, nextActions: nextActions('post_stay_wish', args as Json, result) });
  });
  server.registerTool('get_wish_offers', TOOLS.get_wish_offers, async (args) => {
    const parts = partsOf(args.wishToken);
    if (!parts) return forwardWish('get_wish_offers', args.wishToken);
    const settled = await Promise.allSettled(parts.map(async ([id, token]) => {
      const l = guide.get(id);
      if (!l) throw new RemoteError('Installation no longer listed.');
      return listedOnly(l, prefixIds(((await callInstance(l, 'get_wish_offers', { wishToken: token }, agentName)).offers as Json[]) ?? [], l.instanceId));
    }));
    const offers = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
    // Host offers first; within each kind the lowest total first (only comparable within one currency).
    offers.sort((a, b) => Number(b.source === 'host') - Number(a.source === 'host') || (a.currency === b.currency ? Number(a.total ?? 0) - Number(b.total ?? 0) : 0));
    const result: Json = { status: 'open', offers, hostOffers: offers.filter((o) => o.source === 'host').length, installationsUnreachable: settled.filter((s) => s.status === 'rejected').length };
    return ok({ ...result, nextActions: nextActions('get_wish_offers', args as Json, result) });
  });
  server.registerTool('withdraw_stay_wish', TOOLS.withdraw_stay_wish, async (args) => {
    const parts = partsOf(args.wishToken);
    if (!parts) return forwardWish('withdraw_stay_wish', args.wishToken);
    await Promise.allSettled(parts.map(([id, token]) => {
      const l = guide.get(id);
      return l ? callInstance(l, 'withdraw_stay_wish', { wishToken: token }, agentName) : Promise.resolve({});
    }));
    return ok({ status: 'withdrawn' });
  });
  const forwardWish = async (tool: string, token: string) => toolError(`Unknown wishToken for this guide (${tool}).`, { code: 'NOT_FOUND', nextTools: ['post_stay_wish'] });

  // Stays may live on different installations: compare per installation, then merge.
  server.registerTool('compare_stays', TOOLS.compare_stays, async (args) => {
    try {
      const groups = new Map<string, { listing: Listing; ids: string[] }>();
      for (const id of args.propertyIds) {
        const { listing, localId } = route(guide, id, 'propertyId');
        const g = groups.get(listing.instanceId) ?? { listing, ids: [] };
        g.ids.push(localId);
        groups.set(listing.instanceId, g);
      }
      const rows: Json[] = [];
      let first: Json | undefined;
      for (const { listing, ids } of groups.values()) {
        const res = await callInstance(listing, 'compare_stays', { ...args, propertyIds: ids }, agentName);
        first ??= res;
        rows.push(...prefixIds((res.rows as Json[]) ?? [], listing.instanceId));
      }
      return ok({ ...first, rows });
    } catch (err) {
      return remoteFailure(err);
    }
  });
  return server;
}
