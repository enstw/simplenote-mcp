# TODO

Open follow-ups not yet addressed. Remove items as they land.

## Rotate the tokens exposed during the 2026-07-01 deploy

Both `CLOUDFLARE_API_TOKEN` and `SIMPLENOTE_TOKEN` were pasted into an AI chat
transcript during the deploy, so treat them as compromised and rotate:

- **Cloudflare API token** — delete it (dashboard → My Profile → API Tokens),
  mint a fresh one, update `.deploy.env`. Deploy-only, so rotating breaks nothing.
- **Simplenote/Simperium token** — re-mint, then push the new value:
  `printf '%s' NEWTOKEN | pnpm exec wrangler secret put SIMPLENOTE_TOKEN`. This is
  the live store credential, so higher priority.

## README — token-acquisition wording (Deploy section)

The Deploy prereqs frame the Simperium token as something you "mint from your
Simplenote email/password," which misrepresents the normal workflow — the
connector's runtime auth is **token-only** (`X-Simperium-Token`; see the header
comment in `src/simperium.ts`), and the account owner supplies an existing token
rather than handling email/password.

Reframe so the **token is the primary input**. If we document how to obtain one,
lead with the token-extraction path (grab the `X-Simperium-Token` header from a
logged-in `app.simplenote.com` session) and present the `simplenote` library's
`get_token(EMAIL, PASSWORD)` mint only as an optional fallback, clearly scoped to
a one-time mint.

Decision still open: which acquisition method to make the documented primary
(web-app token extraction vs. library mint vs. generic "obtain a token").

## README — `pip` violates the uv-only house rule

The same Deploy snippet uses `pip install simplenote`. This machine is `uv`-only
(no `pip`). If any library-based mint path survives the rewrite above, it must use
uv, e.g. `uv run --with simplenote python -c "..."` — never `pip`.
