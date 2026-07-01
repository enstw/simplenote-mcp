/**
 * The MCP server: a Durable Object (via McpAgent) exposing a small, file-shaped
 * tool surface backed by Simplenote. Streamable HTTP is mounted at /mcp by the
 * OAuthProvider in index.ts.
 *
 * Scope is per Claude.ai project. One shared connector serves the whole account,
 * but Claude.ai sends no project id to a connector, so each call must carry a
 * `project` key (sourced from that project's BOOTSTRAP.md). The key composes the
 * Simplenote tag `claude-project-<key>`, which isolates one project's notes from
 * the rest of the account.
 */

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { Simperium } from "./simperium";
import { FileNotFound, SimplenoteStore } from "./store";
import type { Env } from "./types";

/** Allowed shape of a project key (post-normalization): a slug. */
const PROJECT_KEY_RE = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Compose the per-project Simplenote tag from the caller-supplied key. Required
 * and validated: a missing key errors loudly rather than silently pooling every
 * project into one shared bucket.
 */
export function projectTag(project: string): string {
  const key = (project ?? "").trim().toLowerCase();
  if (!key) {
    throw new Error(
      "missing `project`: pass the project key from this project's BOOTSTRAP.md " +
        "(its 'Project key' line) so files are scoped to this Claude.ai project.",
    );
  }
  if (!PROJECT_KEY_RE.test(key)) {
    throw new Error(
      `invalid project key ${JSON.stringify(project)}: use lowercase letters, ` +
        `digits, '.', '_' or '-' (e.g. "research").`,
    );
  }
  return `claude-project-${key}`;
}

const PROJECT_ARG = {
  project: z
    .string()
    .describe(
      "Project key that scopes files to this Claude.ai project — the 'Project " +
        "key' from this project's BOOTSTRAP.md. Required on every call.",
    ),
};

export class SimplenoteMCP extends McpAgent<Env> {
  server = new McpServer({ name: "simplenote", version: "0.1.0" });

  private store(project: string): SimplenoteStore {
    return new SimplenoteStore(new Simperium(this.env.SIMPLENOTE_TOKEN), projectTag(project));
  }

  async init(): Promise<void> {
    this.server.tool(
      "list_files",
      "List the project's persisted files (one Simplenote note per file). Call " +
        "this first to discover existing state. Returns each file's path, " +
        "Simplenote key, version, modified (epoch seconds) and tags. Scoped to " +
        "the given `project`.",
      PROJECT_ARG,
      async ({ project }) => {
        try {
          return json(await this.store(project).listFiles());
        } catch (e) {
          return toolError(e);
        }
      },
    );

    this.server.tool(
      "read_file",
      "Read one persisted file's full content by path (use a path from " +
        "list_files). Pull it, then write it into the sandbox to work on it.",
      { ...PROJECT_ARG, path: z.string().describe("File path, e.g. Design-Notes.md") },
      async ({ project, path }) => {
        try {
          return text(await this.store(project).readFile(path));
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
        ...PROJECT_ARG,
        path: z.string().describe("File path, e.g. Design-Notes.md"),
        content: z.string().describe("Full file content (Markdown/text)"),
      },
      async ({ project, path, content }) => {
        try {
          return json(await this.store(project).writeFile(path, content));
        } catch (e) {
          return toolError(e);
        }
      },
    );

    this.server.tool(
      "delete_file",
      "Soft-delete (trash) a persisted file by path.",
      { ...PROJECT_ARG, path: z.string().describe("File path to trash") },
      async ({ project, path }) => {
        try {
          await this.store(project).deleteFile(path);
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
