"""MCP server exposing Simplenote as a persistent file store.

Tools (a deliberately small, file-shaped surface):

    list_files()              -> [{path, key, version, modified, tags}, ...]
    read_file(path)           -> str
    write_file(path, content) -> {path, key, version, modified, tags}
    delete_file(path)         -> str

Config comes from the environment so one process serves exactly one project:

    SIMPLENOTE_TOKEN         Simperium API token (password never needed here).
    SIMPLENOTE_PROJECT_TAG   Tag scoping this project's notes (e.g. claude-project-abc).
    MCP_TRANSPORT            "stdio" (local/desktop) or "http" (remote, streamable-http).
    HOST / PORT              Bind address for http transport (default 127.0.0.1:8000).

For Claude.ai *web chat* the connector must run remotely over http and sit
behind an OAuth layer (see README "Deploying for Claude.ai"). For Claude Code /
Claude Desktop, stdio with a token in the environment works directly.
"""

from __future__ import annotations

import argparse
import os
from dataclasses import asdict

from mcp.server.fastmcp import FastMCP

from .store import FileMeta, SimplenoteStore

mcp = FastMCP("simplenote")


def _store() -> SimplenoteStore:
    """Build a store from the environment. Stateless: one per tool call."""
    return SimplenoteStore(
        token=os.environ.get("SIMPLENOTE_TOKEN", ""),
        project_tag=os.environ.get("SIMPLENOTE_PROJECT_TAG", "claude-project-default"),
    )


def _meta(m: FileMeta) -> dict:
    return asdict(m)


@mcp.tool()
def list_files() -> list[dict]:
    """List the project's persisted files (one Simplenote note per file).

    Call this first in a conversation to discover what state exists. Returns
    each file's ``path`` (e.g. ``Design-Notes.md``), Simplenote ``key``,
    current ``version``, ``modified`` epoch seconds, and ``tags``.
    """
    return [_meta(m) for m in _store().list_files()]


@mcp.tool()
def read_file(path: str) -> str:
    """Read one persisted file's full content by ``path``.

    Use the ``path`` values returned by ``list_files``. Pull a file with this,
    then write it into the sandbox (e.g. /mnt/user-data/outputs/<path>) to work
    on it. Errors if the path does not exist.
    """
    return _store().read_file(path)


@mcp.tool()
def write_file(path: str, content: str) -> dict:
    """Create or overwrite a persisted file, returning its new metadata.

    This is how state is *persisted across conversations*. The first-line
    heading of ``content`` becomes the note title and defines the path (keep it
    consistent with ``path``). Content is plain text / Markdown only — no
    binaries. Overwrites are last-writer-wins against the latest version.
    """
    return _meta(_store().write_file(path, content))


@mcp.tool()
def delete_file(path: str) -> str:
    """Soft-delete (trash) a persisted file by ``path``. Errors if missing."""
    _store().delete_file(path)
    return f"deleted {path}"


def main() -> None:
    parser = argparse.ArgumentParser(prog="simplenote-mcp", description=__doc__)
    parser.add_argument(
        "--transport",
        choices=["stdio", "http"],
        default=os.environ.get("MCP_TRANSPORT", "stdio"),
        help="stdio for local/desktop, http (streamable-http) for a remote connector",
    )
    parser.add_argument("--host", default=os.environ.get("HOST"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    args = parser.parse_args()

    if args.transport == "http":
        if args.host:
            mcp.settings.host = args.host
        mcp.settings.port = args.port
        mcp.run(transport="streamable-http")
    else:
        mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
