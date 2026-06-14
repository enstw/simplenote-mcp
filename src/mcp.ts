/**
 * The MCP server: a Durable Object (via McpAgent) exposing a small, file-shaped
 * tool surface backed by Simplenote. Streamable HTTP is mounted at /mcp by the
 * OAuthProvider in index.ts.
 */

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { Simperium } from "./simperium";
import { FileNotFound, SimplenoteStore } from "./store";
import type { Env } from "./types";

export class SimplenoteMCP extends McpAgent<Env> {
  server = new McpServer({ name: "simplenote", version: "0.1.0" });

  private store(): SimplenoteStore {
    return new SimplenoteStore(
      new Simperium(this.env.SIMPLENOTE_TOKEN),
      this.env.SIMPLENOTE_PROJECT_TAG || "claude-project-default",
    );
  }

  async init(): Promise<void> {
    this.server.tool(
      "list_files",
      "List the project's persisted files (one Simplenote note per file). Call " +
        "this first to discover existing state. Returns each file's path, " +
        "Simplenote key, version, modified (epoch seconds) and tags.",
      async () => json(await this.store().listFiles()),
    );

    this.server.tool(
      "read_file",
      "Read one persisted file's full content by path (use a path from " +
        "list_files). Pull it, then write it into the sandbox to work on it.",
      { path: z.string().describe("File path, e.g. Design-Notes.md") },
      async ({ path }) => {
        try {
          return text(await this.store().readFile(path));
        } catch (e) {
          return toolError(e);
        }
      },
    );

    this.server.tool(
      "write_file",
      "Create or overwrite a persisted file (this is how state survives across " +
        "conversations). The first-line heading of content becomes the note " +
        "title and defines the path. Text/Markdown only; last-writer-wins.",
      {
        path: z.string().describe("File path, e.g. Design-Notes.md"),
        content: z.string().describe("Full file content (Markdown/text)"),
      },
      async ({ path, content }) => {
        try {
          return json(await this.store().writeFile(path, content));
        } catch (e) {
          return toolError(e);
        }
      },
    );

    this.server.tool(
      "delete_file",
      "Soft-delete (trash) a persisted file by path.",
      { path: z.string().describe("File path to trash") },
      async ({ path }) => {
        try {
          await this.store().deleteFile(path);
          return text(`deleted ${path}`);
        } catch (e) {
          return toolError(e);
        }
      },
    );
  }
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function text(s: string): ToolResult {
  return { content: [{ type: "text", text: s }] };
}
function json(v: unknown): ToolResult {
  return text(JSON.stringify(v, null, 2));
}
function toolError(e: unknown): ToolResult {
  const msg = e instanceof FileNotFound ? e.message : e instanceof Error ? e.message : String(e);
  return { content: [{ type: "text", text: msg }], isError: true };
}
