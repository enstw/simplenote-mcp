# Simplenote connector self-test

A throwaway prompt to confirm the connector is wired up correctly in a Claude.ai
project (or any MCP client). It exercises all four tools in a round-trip and
cleans up after itself.

This is **distinct from `BOOTSTRAP.md`**: `BOOTSTRAP.md` is the real,
add-it-to-the-project persistence *protocol*; this file is a one-off wiring check.
Run it once after connecting, then rely on `BOOTSTRAP.md` for actual use.

## How to run

Paste the block below into a conversation **in the project that has the
Simplenote connector attached**. (Connectors are per-project — if the tools are
missing, attach the connector to that project first.)

## The test

```
Run a Simplenote connector self-test. You have the connector attached (tools:
list_files, read_file, write_file, delete_file). Do every step in order, show
each tool's result briefly, then give a final verdict. Don't write anything into
the sandbox — this only tests the connector tools.

1. TOOLS PRESENT — Confirm all four tools exist. If any are missing, stop and
   tell me the connector isn't attached to this project.

2. BASELINE — Call list_files. Report how many files exist and list their paths.
   (Likely zero — that's fine.) Remember this baseline set of paths.

3. WRITE — Call write_file with:
     path:    connector-test
     content:
       # Connector Test <put today's date + a random 4-digit number here>

       If you can read this back verbatim, the Simplenote round-trip works.
   Note: the first-line heading becomes the real filename, so the STORED path
   will be the slug of that heading (e.g. Connector-Test-....md), NOT
   "connector-test". Don't assume the path — discover it in the next step.

4. CONFIRM CREATED — Call list_files again. The new file is the path that wasn't
   in the baseline. Report its path, key, and version.

5. READ BACK — Call read_file on that new path. Confirm the content matches,
   character for character, what you wrote in step 3.

6. CLEAN UP — Call delete_file on that new path.

7. CONFIRM GONE — Call list_files once more and confirm the test file is no
   longer listed.

Finish with: ✅ PASS if write→list→read→delete all worked and the content
matched, or ❌ FAIL naming the exact step and error that broke.
```

## What a passing run looks like

Baseline (probably empty) → a new `Connector-Test-….md` appears → its content
reads back identically → it's deleted → the final list no longer shows it. The
test note is tag-scoped and trashed at the end, so it leaves the store exactly as
it was (and it's recoverable from Simplenote's trash if needed).

## Notes

- The "heading owns the path" rule is the one subtle thing this test validates:
  `write_file(path, content)` stores the note under the slug of `content`'s first
  line, not under the `path` you passed. Always discover the real path via
  `list_files` rather than assuming it.
- Verified working end-to-end on 2026-07-01 against
  `https://simplenote-mcp.enstw.workers.dev` (both via the raw MCP+OAuth protocol
  and via the live tools inside Claude Code).
