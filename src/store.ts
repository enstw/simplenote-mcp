/**
 * File-like view over the Simplenote notes carrying one project tag. TypeScript
 * port of the Python `simplenote_mcp/store.py`, with the same conventions:
 *
 *  - one note per file; a file's `path` is the slug of its first-line heading
 *    (`# Design Notes` → `Design-Notes.md`), matching the `sn` CLI;
 *  - notes are scoped by a project tag (e.g. `claude-project-<id>`);
 *  - stateless: the path→note index is rebuilt from the live note list each call;
 *  - writes are last-writer-wins (latest version is fetched right before update).
 */

import { Note, NoteData, Simperium, withDefaults } from "./simperium";

const MARKDOWN_SYSTEM_TAG = "markdown";

export interface FileMeta {
  path: string;
  key: string;
  version: number;
  modified: number;
  tags: string[];
}

export class FileNotFound extends Error {
  constructor(path: string) {
    super(`no such file: ${path}`);
  }
}

/** First-line heading → safe path stem. Mirrors `store.py`'s `slugify`. */
export function slugify(title: string): string {
  let t = title.replace(/^#+\s*/, "").trim();
  if (!t) return "";
  // Keep letters (incl. CJK), numbers, underscore, whitespace and hyphen.
  t = t.replace(/[^\p{L}\p{N}_\s-]/gu, "");
  t = t.replace(/\s+/g, "-").replace(/^-+|-+$/g, "");
  return t.slice(0, 80);
}

/** Derive a unique `.md` path for a note, avoiding collisions in `taken`. */
export function notePath(note: Note, taken: Set<string>): string {
  const firstLine = (note.content ?? "").split("\n", 1)[0]?.trim() ?? "";
  const stem = slugify(firstLine) || note.key.slice(0, 8);
  let name = `${stem}.md`;
  let counter = 1;
  while (taken.has(name)) name = `${stem}-${counter++}.md`;
  return name;
}

export class SimplenoteStore {
  constructor(
    private readonly sim: Simperium,
    private readonly projectTag: string,
  ) {
    if (!projectTag) throw new Error("project tag is required");
  }

  /** Non-deleted notes carrying the project tag. */
  private async listNotes(): Promise<Note[]> {
    const all = await this.sim.index();
    return all.filter((n) => !n.deleted && (n.tags ?? []).includes(this.projectTag));
  }

  /** path → FileMeta. Sorted by creationDate so collision suffixes are stable. */
  private async index(): Promise<Map<string, FileMeta>> {
    const notes = (await this.listNotes()).sort(
      (a, b) => (a.creationDate ?? 0) - (b.creationDate ?? 0),
    );
    const taken = new Set<string>();
    const map = new Map<string, FileMeta>();
    for (const n of notes) {
      const path = notePath(n, taken);
      taken.add(path);
      map.set(path, {
        path,
        key: n.key,
        version: n.version,
        modified: n.modificationDate ?? 0,
        tags: n.tags ?? [],
      });
    }
    return map;
  }

  async listFiles(): Promise<FileMeta[]> {
    const metas = [...(await this.index()).values()];
    return metas.sort((a, b) => a.path.localeCompare(b.path));
  }

  async readFile(path: string): Promise<string> {
    const meta = (await this.index()).get(path);
    if (!meta) throw new FileNotFound(path);
    const note = await this.sim.get(meta.key);
    return note.content ?? "";
  }

  async writeFile(path: string, content: string): Promise<FileMeta> {
    const now = Date.now() / 1000;
    const meta = (await this.index()).get(path);
    let result: Note;
    if (meta) {
      // Re-fetch for the freshest version (optimistic concurrency / last-writer-wins).
      const current = await this.sim.get(meta.key);
      const tags = [...(current.tags ?? [])];
      if (!tags.includes(this.projectTag)) tags.push(this.projectTag);
      const data: NoteData = withDefaults(
        {
          ...current,
          content,
          tags,
          systemTags: withMarkdown(current.systemTags),
          modificationDate: now,
        },
        now,
      );
      result = await this.sim.write(meta.key, current.version, data);
    } else {
      const data = withDefaults(
        {
          content,
          tags: [this.projectTag],
          systemTags: [MARKDOWN_SYSTEM_TAG],
          creationDate: now,
          modificationDate: now,
        },
        now,
      );
      result = await this.sim.write(null, null, data);
    }
    return {
      path,
      key: result.key,
      version: result.version,
      modified: result.modificationDate ?? now,
      tags: result.tags ?? [],
    };
  }

  /** Soft-delete (trash): mark deleted and write, mirroring `trash_note`. */
  async deleteFile(path: string): Promise<void> {
    const meta = (await this.index()).get(path);
    if (!meta) throw new FileNotFound(path);
    const current = await this.sim.get(meta.key);
    if (current.deleted) return;
    const now = Date.now() / 1000;
    const data = withDefaults({ ...current, deleted: true, modificationDate: now }, now);
    await this.sim.write(meta.key, current.version, data);
  }
}

function withMarkdown(systemTags: string[] | undefined): string[] {
  const tags = [...(systemTags ?? [])];
  if (!tags.includes(MARKDOWN_SYSTEM_TAG)) tags.push(MARKDOWN_SYSTEM_TAG);
  return tags;
}
