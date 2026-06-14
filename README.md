# simplenote-mcp

A **remote MCP connector that gives Claude.ai *projects* a persistent,
cross-conversation file store**, backed by Simplenote and deployed free on
Cloudflare Workers.

## The problem

A Claude.ai project conversation has **no writable storage that survives across
conversations** — confirmed by probing the project sandbox from inside it:

| Surface | Agent can write? | Crosses conversations? |
|---|---|---|
| `/mnt/project` | no (only the user adds files) | yes |
| `/mnt/user-data/outputs` | yes | **no — keyed per conversation** |
| VM (`/home`, `/tmp`) | yes | no (ephemeral) |

`/mnt/user-data/outputs` is durable *within* a conversation, but its storage
namespace is the conversation id — a file written in one conversation is
invisible in the next, even inside the same project. The only cross-conversation
surface, `/mnt/project`, is read-only to the agent. So there is no
writable **and** cross-conversation surface — and because the sandbox's network
egress is allow-listed, a script running inside it can't reach Simplenote
directly either.

This connector supplies the missing surface from *outside* the sandbox: each
conversation pulls its files at the start and pushes changes back before ending.
The pull→work→push protocol the in-conversation agent follows lives in
[`BOOTSTRAP.md`](./BOOTSTRAP.md) — add that file to your Claude project.

## Why Cloudflare Workers

A connector must answer **instantly** when Claude calls a tool, which rules out
free hosts that sleep. Workers never sleep (~5 ms cold start), the free tier
needs **no credit card**, HTTPS is built in, and it's Anthropic's reference path
for remote MCP **with OAuth** (`workers-oauth-provider` + `McpAgent`). SQLite
Durable Objects — which `McpAgent` uses for session state — are now on the free
plan, so the whole thing runs for $0. (The sandbox's allow-listed egress can't
reach Simplenote, so the connector has to be remote anyway.)

The Simplenote/Simperium client is a faithful TypeScript port of the public
[`simplenote.py`](https://github.com/mrtazz/simplenote.py) library (token auth,
the first-line-heading→filename convention, version-aware writes, `markdown`
system tag), so notes round-trip with the Simplenote apps.

## Model

One Simplenote **note per file**, scoped by a project **tag**
(`claude-project-<id>`) that isolates a project's notes from the rest of the
account. A file's `path` is the slug of its first-line heading
(`# Design Notes` → `Design-Notes.md`).

| Tool | Purpose |
|---|---|
| `list_files` | discover persisted files |
| `read_file(path)` | pull one file |
| `write_file(path, content)` | persist/overwrite a file |
| `delete_file(path)` | trash a file |

Single-user by design: one Simplenote account (token stored as a Worker secret);
OAuth just gates access to you with a shared password.

## Deploy

Prereqs: a free Cloudflare account, [pnpm](https://pnpm.io) + Node, and a
Simplenote API token. Mint one from your Simplenote email/password with the
public [`simplenote`](https://pypi.org/project/simplenote/) library:

```bash
pip install simplenote
python -c "from simplenote import Simplenote; print(Simplenote('EMAIL', 'PASSWORD').get_token())"
```

```bash
pnpm install

# 1. Create the KV namespace the OAuth provider uses, then paste the printed id
#    into wrangler.jsonc (kv_namespaces[0].id).
pnpm exec wrangler kv namespace create OAUTH_KV

# 2. (optional) set your project tag in wrangler.jsonc → vars.SIMPLENOTE_PROJECT_TAG

# 3. Set secrets (not in any file):
pnpm exec wrangler secret put SIMPLENOTE_TOKEN     # your Simperium token
pnpm exec wrangler secret put ACCESS_PASSWORD      # a password you choose

# 4. Ship it:
pnpm run deploy
```

You'll get `https://simplenote-mcp.<your-subdomain>.workers.dev`.

**Connect in Claude.ai** (Max/Team/Enterprise): Settings → Connectors → *Add
custom connector* → URL `https://simplenote-mcp.<subdomain>.workers.dev/mcp`.
Claude runs the OAuth flow; enter your `ACCESS_PASSWORD` on the login screen.
Then add [`BOOTSTRAP.md`](./BOOTSTRAP.md) to the project.

## Local development

```bash
cp .dev.vars.example .dev.vars     # fill in SIMPLENOTE_TOKEN + ACCESS_PASSWORD
pnpm dev                           # wrangler dev (local Worker)
pnpm dlx @modelcontextprotocol/inspector   # point at http://localhost:8787/mcp
```

```bash
pnpm run typecheck   # tsc --noEmit
pnpm test            # vitest: store/simperium logic (in-memory, no network)
```

## Layout

- `src/index.ts` — OAuthProvider wiring (the entrypoint)
- `src/mcp.ts` — `McpAgent` Durable Object + the four tools
- `src/store.ts` — file↔note mapping, tag scoping (port of `store.py`)
- `src/simperium.ts` — Simperium HTTP client (port of `simplenote.py`)
- `src/auth.ts` — single-user OAuth login gate
- `BOOTSTRAP.md` — the doc you add to the Claude project
- `python/` — optional local **stdio** variant for Claude Desktop / Claude Code
