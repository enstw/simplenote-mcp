/**
 * Minimal Simperium client for the Simplenote `note` bucket — a direct port of
 * the relevant parts of the `simplenote.py` library
 * (mrtazz/simplenote.py), using the Workers `fetch` API.
 *
 * Auth is token-only: the caller supplies an existing Simperium access token
 * (no email/password here). Endpoints, headers and the app id match the
 * library verbatim, so notes round-trip with the `sn` CLI and the Simplenote
 * apps.
 */

const APP_ID = "chalk-bump-f49";
const BUCKET = "note";
const DATA_URL = `https://api.simperium.com/1/${APP_ID}/${BUCKET}`;
const TOKEN_HEADER = "X-Simperium-Token";
const VERSION_HEADER = "X-Simperium-Version";
const FETCH_LIMIT = 1000;

/** The mutable fields of a Simplenote note (what lives in Simperium's `d`). */
export interface NoteData {
  content: string;
  tags: string[];
  systemTags: string[];
  creationDate: number;
  modificationDate: number;
  deleted: boolean;
  shareURL: string;
  publishURL: string;
}

/** A note plus its Simperium identity. */
export interface Note extends NoteData {
  key: string;
  version: number;
}

interface IndexEntry {
  id: string;
  v: number;
  d: Partial<NoteData>;
}
interface IndexResponse {
  current: string;
  index: IndexEntry[];
  mark?: string;
}

export class SimperiumError extends Error {}

/** Fill a partial note with the same defaults `simplenote.py` applies on write. */
export function withDefaults(data: Partial<NoteData>, now: number): NoteData {
  return {
    content: data.content ?? "",
    tags: data.tags ?? [],
    systemTags: data.systemTags ?? [],
    creationDate: data.creationDate ?? now,
    modificationDate: data.modificationDate ?? now,
    deleted: data.deleted ?? false,
    shareURL: data.shareURL ?? "",
    publishURL: data.publishURL ?? "",
  };
}

export class Simperium {
  constructor(private readonly token: string) {
    if (!token) throw new SimperiumError("SIMPLENOTE_TOKEN is required");
  }

  private get headers(): Record<string, string> {
    return { [TOKEN_HEADER]: this.token };
  }

  /** All notes in the bucket (paginated via `mark`), with their data objects. */
  async index(): Promise<Note[]> {
    const out: Note[] = [];
    const base = `${DATA_URL}/index?limit=${FETCH_LIMIT}&data=true`;
    let mark: string | undefined;
    do {
      const url = mark ? `${base}&mark=${encodeURIComponent(mark)}` : base;
      const res = await fetch(url, { headers: this.headers });
      if (!res.ok) throw await this.error("index", res);
      const body = (await res.json()) as IndexResponse;
      for (const e of body.index) {
        out.push({ ...withDefaults(e.d, 0), key: e.id, version: e.v });
      }
      mark = body.mark;
    } while (mark);
    return out;
  }

  /** Fetch one note by key (latest version). */
  async get(key: string): Promise<Note> {
    const res = await fetch(`${DATA_URL}/i/${key}`, { headers: this.headers });
    if (!res.ok) throw await this.error("get", res);
    const d = (await res.json()) as Partial<NoteData>;
    const version = Number(res.headers.get(VERSION_HEADER) ?? 0);
    return { ...withDefaults(d, 0), key, version };
  }

  /**
   * Create or update a note. Pass `key`/`baseVersion` to update an existing
   * note at that version (optimistic concurrency); pass `null` for both to
   * create a new note with a fresh uuid key.
   */
  async write(key: string | null, baseVersion: number | null, data: NoteData): Promise<Note> {
    const id = key ?? crypto.randomUUID().replace(/-/g, "");
    const url =
      baseVersion != null
        ? `${DATA_URL}/i/${id}/v/${baseVersion}?response=1`
        : `${DATA_URL}/i/${id}?response=1`;
    const res = await fetch(url, {
      method: "POST",
      headers: { ...this.headers, "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw await this.error("write", res);
    const d = (await res.json()) as Partial<NoteData>;
    const version = Number(res.headers.get(VERSION_HEADER) ?? 0);
    return { ...withDefaults(d, data.modificationDate), key: id, version };
  }

  private async error(op: string, res: Response): Promise<SimperiumError> {
    if (res.status === 401) {
      return new SimperiumError(`Simplenote auth failed (401) on ${op} — check SIMPLENOTE_TOKEN`);
    }
    const body = await res.text().catch(() => "");
    return new SimperiumError(`Simperium ${op} failed: ${res.status} ${body}`.trim());
  }
}
