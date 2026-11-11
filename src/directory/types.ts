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

/** How the guide knows the agent: the domain it verified (Web Bot Auth), or `anonymous`. Signed by the guide. */
export const GUIDE_IDENTITY_HEADER = 'x-innli-relay-identity';
/** A non-reversible id of the caller at the guide, so limits count per caller and not for the whole guide. Signed by the guide. */
export const GUIDE_HOLDER_HEADER = 'x-innli-relay-holder';

/** Who called the guide, as it is relayed to installations. */
export interface GuideCaller {
  name: string;
  /** Domain whose key signed the agent's request to the guide. */
  verifiedDomain?: string;
  holder: string;
}
