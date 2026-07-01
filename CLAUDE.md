# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **remote MCP connector that gives Claude.ai *projects* a persistent,
cross-conversation file store**, backed by Simplenote and deployed on
**Cloudflare Workers** (free tier). The primary implementation is the TypeScript
Worker at the repo root; `python/` holds an optional local **stdio** variant for
Claude Desktop / Claude Code.

## Toolchain (read first)

Package manager is **pnpm** (v11) with **Node** (v24), both under
`~/.local/share/pnpm` via `PNPM_HOME`. The login shell has them on PATH, but a
**non-interactive shell (the Bash tool) does not** — prefix commands with:

```bash
export PNPM_HOME="$HOME/.local/share/pnpm"; export PATH="$PNPM_HOME/bin:$PATH"
```

`npm` is disabled on this machine. Native build scripts are gated by a strict
pnpm policy: approvals live in `pnpm-workspace.yaml` under `allowBuilds:`
(esbuild + workerd are `true`; the rest `false`). If `pnpm install` ever fails
with `ERR_PNPM_IGNORED_BUILDS`, set the new package to true/false there — do
**not** put build settings in package.json's `pnpm` field (pnpm v11 ignores it).

```bash
pnpm install
pnpm run typecheck                          # tsc --noEmit  (must stay green)
pnpm test                                   # vitest: store/simperium logic, in-memory
pnpm exec wrangler deploy --dry-run --outdir dist   # bundle + binding validation, no auth
pnpm dev                                    # local Worker (wrangler dev)
pnpm run deploy                             # real deploy (needs Cloudflare login)
```

## The problem it solves

A project conversation has no writable storage that survives across
conversations (measured by probing the sandbox from inside): `/mnt/project` is
cross-conversation but read-only to the agent; `/mnt/user-data/outputs` is
writable but per-conversation (its storage namespace is the conversation id);
the VM is ephemeral. This connector bridges to Simplenote as the durable,
cross-conversation store. The in-conversation agent's pull→work→push protocol is
`BOOTSTRAP.md` (the file the user adds to the project store). The README's "The
problem" section is the canonical write-up.

## Two hard constraints

1. **Must be remote, not in-sandbox.** The project sandbox has allow-listed
   egress — `api.simperium.com` is unreachable from
   inside. Data crosses only as MCP tool results, which the agent writes into
   `/mnt/user-data/outputs`. The connector therefore runs on Cloudflare, outside
   the sandbox.
2. **No official Simplenote API.** It runs on **Simperium**. `src/simperium.ts`
   is a direct port of the `simplenote.py` library (the `simplenote` PyPI
   package): app id `chalk-bump-f49`,
   bucket `note`, header `X-Simperium-Token`, `/index?data=true` with `mark`
   pagination, `/i/{id}/v/{version}?response=1` for versioned writes, uuid-hex
   keys for new notes, client-side tag filtering.

## Architecture

OAuth fronts everything; the MCP server is a Durable Object; Simplenote is the
store. One note per file, scoped to a Claude.ai project by a **tag**
(`claude-project-<key>`). Claude.ai sends no project id to a connector, so the
`key` is supplied **in-band**: every tool takes a required `project` argument
(sourced from that project's `BOOTSTRAP.md`). One shared connector therefore
serves the whole account with per-project isolation. A file's `path` is the slug
of its first-line heading.

- `src/index.ts` — `OAuthProvider` from `@cloudflare/workers-oauth-provider`.
  `apiRoute: "/mcp"` → `SimplenoteMCP.serve("/mcp")` (Streamable HTTP);
  `defaultHandler` → the auth app; provider implements `/token` + `/register`
  (OAuth 2.1 + dynamic client registration, which is what Claude.ai requires).
- `src/mcp.ts` — `SimplenoteMCP extends McpAgent<Env>` (from `agents/mcp`) with
  an `McpServer`; `init()` registers `list_files` / `read_file` / `write_file` /
  `delete_file`, each taking a required `project` key. `projectTag()` validates
  the key and composes `claude-project-<key>`; a missing/invalid key returns a
  tool error rather than pooling into a shared store. Reads
  `this.env.SIMPLENOTE_TOKEN`.
- `src/store.ts` — `SimplenoteStore`: file↔note mapping, tag scoping. Port of
  `python/simplenote_mcp/store.py`. **Stateless**: the path→note index is rebuilt
  from the live note list each call (each MCP request may hit a fresh DO).
- `src/simperium.ts` — the Simperium HTTP client (above).
- `src/auth.ts` — Hono app: single-user OAuth login gate. `/authorize` renders a
  password form; on a correct `ACCESS_PASSWORD` it calls
  `env.OAUTH_PROVIDER.completeAuthorization(...)`. No per-user props — the
  Simplenote token is a Worker secret.
- `src/types.ts` — the `Env` bindings/secrets (no scope var; scope is in-band).
- `wrangler.jsonc` — DO binding `MCP_OBJECT` + **SQLite** migration (free-plan
  compatible), KV `OAUTH_KV`. No scope var — the project key is per-call.

### Non-obvious decisions

- **Single-user.** One Simplenote account; token + access password are Worker
  secrets (`wrangler secret put`). OAuth only gates access to the owner.
- **Per-project scope is in-band, not server-side.** Claude.ai passes no project
  id (and one shared connector has one OAuth client id across all projects), so
  isolation rides on the `project` key each call carries, set per project in its
  `BOOTSTRAP.md`. This is an organizational boundary within one account, not a
  security one — the key is agent-supplied and discoverable. The key is
  *required*: a missing one errors instead of silently sharing a bucket (the bug
  this replaced, where a static `SIMPLENOTE_PROJECT_TAG` pooled every project).
- **Last-writer-wins.** `writeFile` re-fetches the latest version right before
  `write` — no interactive merge (matches `sn`).
- **The heading owns the path.** Writing content whose first line differs from
  `path` renames the file on the next `list_files`. Intentional, shared with `sn`.
- **Defensive tag filter.** `listNotes` filters by tag client-side and drops
  trashed notes (Simperium's index returns the whole bucket).
- **`markdown` is a *system* tag**, the project tag is a *user* tag — kept
  distinct in `store.ts`.
- **zod v4** is installed and fine — `@modelcontextprotocol/sdk` accepts
  `^3.25 || ^4.0` and `agents` peer-deps `^4`.
- The Simperium API is **undocumented/unofficial** and may change without notice.

## Deploy / connect (manual steps)

`pnpm exec wrangler kv namespace create OAUTH_KV` → paste id into `wrangler.jsonc`;
`pnpm exec wrangler secret put SIMPLENOTE_TOKEN` + `ACCESS_PASSWORD`; `pnpm run
deploy`; in Claude.ai add a custom connector at `…workers.dev/mcp` and enter the
access password; add `BOOTSTRAP.md` to each project and set its **Project key**
to a unique slug (this is what scopes the project's notes). Requires a Claude
plan with custom connectors (Max/Team/Enterprise).

## Verification status

`tsc --noEmit` is clean; `pnpm test` (vitest) covers slugify parity, path collisions, and a
full create/list/read/update/delete round-trip against an in-memory Simperium;
`wrangler deploy --dry-run` bundles with all bindings resolving (~408 KiB gzip).

**Deployed live 2026-07-01** at `https://simplenote-mcp.enstw.workers.dev`.
Post-deploy checks pass: `GET /` → 200, unauthenticated `GET /mcp` → 401, OAuth
metadata → 200, and `SIMPLENOTE_TOKEN` authenticates against Simperium (index →
200). Still pending: the end-to-end Claude.ai OAuth handshake — adding the custom
connector in the Claude.ai UI and entering the access password (a manual step).

## Key files

- `src/*.ts` — the Worker
- `BOOTSTRAP.md` — the doc the user adds to the Claude project
- the `simplenote` PyPI package / [`simplenote.py`](https://github.com/mrtazz/simplenote.py) — the Simperium porting reference
- `python/` — the local stdio variant
