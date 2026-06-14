# simplenote-mcp (Python / stdio variant)

A local **stdio** MCP server exposing Simplenote as a file store. This is the
no-deploy variant of the connector — useful with **Claude Desktop / Claude
Code**, which can launch a `stdio` MCP server directly with a token in the
environment.

> For **Claude.ai web chat** you need the remote, OAuth-fronted Cloudflare
> Worker in the repo root — web chat only attaches *remote* connectors. See the
> top-level `README.md` and `CLAUDE.md`.

Both variants share the same model (one note per file, scoped by a
`claude-project-<id>` tag) and the same Simplenote integration patterns from
[`../../simplenote-sync`](../../simplenote-sync).

## Run

```bash
uv venv --python 3.12
uv pip install -e .

SIMPLENOTE_TOKEN=… SIMPLENOTE_PROJECT_TAG=claude-project-x \
  uv run simplenote-mcp --transport stdio
```

Get a `SIMPLENOTE_TOKEN` with the `sn` CLI: `sn auth login` then `sn auth token`.

## Tools

`list_files`, `read_file`, `write_file`, `delete_file` — identical surface to the
Worker. Source: `simplenote_mcp/store.py` and `simplenote_mcp/server.py`.
