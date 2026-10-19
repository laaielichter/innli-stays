/** What a self-hosted installation tells the INNLI guide about itself. */
export interface ListingProperty {
  id: string;
  name: string;
  type: string;
  city: string;
  region?: string;
  country: string;
  geo?: { lat: number; lng: number };
  summary: string;
  /** Rooms in total (all room types), for the licence's room limit. */
  rooms?: number;
}

export interface RegistrationRequest {
  instanceId: string;
  /** Public base URL of the installation (its MCP endpoint is `${instanceUrl}/mcp`). */
  instanceUrl: string;
  license?: string;
  version: string;
  /** Release date of the installation's version; a licence covers versions up to its updatesUntil. */
  releaseDate?: string;
  properties: ListingProperty[];
}

/** Served by every installation at /.well-known/innli.json, so the guide can verify who runs a URL. */
export interface WellKnown {
  instanceId: string;
  licenseId?: string;
  version: string;
  /** Public Ed25519 key (SPKI DER, base64) that booking records from this installation are signed with. */
  signingKey?: string;
}

export const GUIDE_AGENT_HEADER = 'x-innli-agent';
