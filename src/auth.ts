/**
 * Default (non-API) handler for the OAuthProvider: a single-user login gate.
 *
 * Claude.ai requires OAuth to attach a custom connector, but this connector
 * serves exactly one Simplenote account, so the "login" is just a shared
 * password check. workers-oauth-provider implements the OAuth protocol
 * (/token, /register, dynamic client registration); we only render the
 * approval screen and call completeAuthorization once the password matches.
 */

import { Hono } from "hono";
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) =>
  c.text("Simplenote MCP connector. Add this URL (with /mcp) as a custom connector in Claude."),
);

app.get("/authorize", async (c) => {
  const reqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  const state = btoa(JSON.stringify(reqInfo));
  return c.html(loginPage(state, false));
});

app.post("/authorize", async (c) => {
  const form = await c.req.formData();
  const password = String(form.get("password") ?? "");
  const state = String(form.get("state") ?? "");

  let reqInfo: AuthRequest;
  try {
    reqInfo = JSON.parse(atob(state)) as AuthRequest;
  } catch {
    return c.html(loginPage("", true), 400);
  }

  if (!c.env.ACCESS_PASSWORD || password !== c.env.ACCESS_PASSWORD) {
    return c.html(loginPage(state, true), 401);
  }

  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: reqInfo,
    userId: "owner",
    metadata: { label: "Simplenote owner" },
    scope: reqInfo.scope ?? [],
    // Single-user: no per-user props; the Simplenote token is a Worker secret.
    props: {},
  });
  return Response.redirect(redirectTo, 302);
});

function loginPage(state: string, error: boolean): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect Simplenote</title>
<style>
  body{font-family:system-ui,sans-serif;background:#eceff1;color:#16191c;
    display:grid;place-items:center;min-height:100vh;margin:0}
  form{background:#fff;padding:28px 26px;border-radius:12px;width:320px;
    box-shadow:0 1px 4px rgba(0,0,0,.12)}
  h1{font-size:1.1rem;margin:0 0 4px} p{color:#6a7479;font-size:.85rem;margin:0 0 18px}
  input{width:100%;padding:10px;border:1px solid #c9d1d6;border-radius:7px;
    font-size:1rem;box-sizing:border-box}
  button{width:100%;margin-top:14px;padding:10px;border:0;border-radius:7px;
    background:#1f5e7a;color:#fff;font-size:1rem;cursor:pointer}
  .err{color:#b3471f;font-size:.85rem;margin:0 0 12px}
</style></head><body>
<form method="post" action="/authorize">
  <h1>Connect Simplenote</h1>
  <p>Enter the access password to link this connector.</p>
  ${error ? '<p class="err">Incorrect password. Try again.</p>' : ""}
  <input type="password" name="password" placeholder="Access password" autofocus required>
  <input type="hidden" name="state" value="${state}">
  <button type="submit">Authorize</button>
</form></body></html>`;
}

export default app;
