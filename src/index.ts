/**
 * Worker entrypoint. The OAuthProvider fronts everything:
 *   - /mcp        → the MCP server (Streamable HTTP), only after OAuth
 *   - /authorize  → our single-user login gate (auth.ts)
 *   - /token, /register → implemented by the provider (OAuth 2.1 + DCR),
 *     which is what Claude.ai needs to attach a custom connector.
 */

import { OAuthProvider } from "@cloudflare/workers-oauth-provider";

import { SimplenoteMCP } from "./mcp";
import authApp from "./auth";

// Durable Object class must be exported for the MCP_OBJECT binding.
export { SimplenoteMCP };

export default new OAuthProvider({
  apiRoute: "/mcp",
  // McpAgent.serve mounts Streamable HTTP at the given path.
  apiHandler: SimplenoteMCP.serve("/mcp") as never,
  defaultHandler: authApp as never,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
