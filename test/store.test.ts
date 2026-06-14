import { describe, expect, test } from "vitest";

import { notePath, SimplenoteStore, slugify } from "../src/store";
import { type Note, type NoteData, withDefaults } from "../src/simperium";

// In-memory stand-in for Simperium that mimics key/version semantics, so we can
// exercise the full store logic (tag scoping, path mapping, create/update/trash)
// without network or the Workers runtime.
class FakeSimperium {
  notes = new Map<string, Note>();
  private seq = 0;

  seed(partial: Partial<Note>): void {
    const key = partial.key ?? `seed${this.seq++}`;
    this.notes.set(key, { ...withDefaults(partial, 0), key, version: partial.version ?? 1 });
  }
  async index(): Promise<Note[]> {
    return [...this.notes.values()].map((n) => ({ ...n }));
  }
  async get(key: string): Promise<Note> {
    const n = this.notes.get(key);
    if (!n) throw new Error(`404 ${key}`);
    return { ...n };
  }
  async write(key: string | null, _v: number | null, data: NoteData): Promise<Note> {
    const id = key ?? `new${this.seq++}`;
    const version = (this.notes.get(id)?.version ?? 0) + 1;
    const n: Note = { ...withDefaults(data, 0), key: id, version };
    this.notes.set(id, n);
    return { ...n };
  }
}

const asStore = (fake: FakeSimperium, tag = "claude-project-x") =>
  new SimplenoteStore(fake as unknown as import("../src/simperium").Simperium, tag);

describe("slugify (parity with store.py)", () => {
  test("strips heading, keeps CJK, collapses spaces", () => {
    expect(slugify("# Design Notes")).toBe("Design-Notes");
    expect(slugify("## 我的 笔记")).toBe("我的-笔记");
    expect(slugify("")).toBe("");
    expect(slugify("###   ")).toBe("");
  });
});

describe("notePath collisions", () => {
  test("appends -1, -2 deterministically", () => {
    const taken = new Set<string>();
    const a = notePath({ content: "# A", key: "k1" } as Note, taken);
    taken.add(a);
    const b = notePath({ content: "# A", key: "k2" } as Note, taken);
    expect([a, b]).toEqual(["A.md", "A-1.md"]);
  });
  test("falls back to key prefix when no heading", () => {
    expect(notePath({ content: "", key: "abcdef1234" } as Note, new Set())).toBe("abcdef12.md");
  });
});

describe("store round-trip, scoped by project tag", () => {
  test("create / list / read / update / delete; other projects ignored", async () => {
    const fake = new FakeSimperium();
    fake.seed({ content: "# Other", tags: ["claude-project-other"] }); // different project
    const store = asStore(fake);

    expect(await store.listFiles()).toHaveLength(0);

    const meta = await store.writeFile("Design-Notes.md", "# Design Notes\nhello");
    expect(meta.path).toBe("Design-Notes.md");
    expect(meta.tags).toContain("claude-project-x"); // project tag applied
    expect(meta.tags).not.toContain("markdown"); // markdown is a *system* tag, not a user tag

    const files = await store.listFiles();
    expect(files.map((f) => f.path)).toEqual(["Design-Notes.md"]);

    expect(await store.readFile("Design-Notes.md")).toBe("# Design Notes\nhello");

    const updated = await store.writeFile("Design-Notes.md", "# Design Notes\nupdated");
    expect(updated.version).toBeGreaterThan(meta.version); // version bumped, not a new note
    expect(await store.readFile("Design-Notes.md")).toBe("# Design Notes\nupdated");
    expect(await store.listFiles()).toHaveLength(1); // still one file, not two

    await store.deleteFile("Design-Notes.md");
    expect(await store.listFiles()).toHaveLength(0);

    expect(store.readFile("Missing.md")).rejects.toThrow();
  });

  test("write sets markdown system tag and project tag on the stored note", async () => {
    const fake = new FakeSimperium();
    await asStore(fake).writeFile("Note.md", "# Note\nbody");
    const stored = [...fake.notes.values()][0];
    expect(stored.systemTags).toContain("markdown");
    expect(stored.tags).toContain("claude-project-x");
    expect(stored.deleted).toBe(false);
  });
});
