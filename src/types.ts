import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

/** Worker bindings, secrets and vars. */
export interface Env {
  // Bindings
  MCP_OBJECT: DurableObjectNamespace;
  OAUTH_KV: KVNamespace;
  /** Injected by workers-oauth-provider into the default (auth) handler. */
  OAUTH_PROVIDER: OAuthHelpers;

  // Secrets (wrangler secret put …)
  /** Simperium API token for the single Simplenote account this connector serves. */
  SIMPLENOTE_TOKEN: string;
  /** Shared password that gates the OAuth login (single-user access). */
  ACCESS_PASSWORD: string;

  // Per-project scope is supplied in-band via each tool's `project` arg (there
  // is no server-side project signal), so no scope var is bound here.
}
