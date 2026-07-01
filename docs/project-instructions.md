# Project instructions (Simplenote connector)

A ready-to-paste snippet for a Claude.ai **project's custom instructions** field
(Settings → the project's *instructions* box, ~8,000 char limit).

## Why put this in instructions, not just in a file

A Claude.ai project has two context surfaces:

- **Custom instructions** — applied to *every* conversation in the project,
  automatically, as a standing directive. Stacks on top of your personal
  preferences.
- **Project knowledge** (uploaded files like `BOOTSTRAP.md`) — passive reference
  material; Claude consults it when relevant but won't necessarily *act* on it.

The pull→work→push protocol is a *behavior that must fire every conversation*, so
its **trigger belongs in instructions**. Keep the full protocol in `BOOTSTRAP.md`
(uploaded as a project file) so it doesn't eat the instruction budget; the
instructions just point to it.

## Paste this into the project's instructions field

```
This project persists files across conversations using the Simplenote connector
(tools: list_files, read_file, write_file, delete_file — deferred; load them with
tool_search before use). Simplenote is the durable store; the sandbox is
per-conversation and disposable.

- When a task plausibly touches persisted state, call list_files to see what
  exists, then read_file only the files that task needs. Don't do this on every
  message — loading the tools and reading files costs a tool_search round trip and
  context tokens, so skip it for unrelated tasks.
- Before finishing, or whenever I say "save"/"persist": write_file every new or
  changed file back, and delete_file anything I want removed. Briefly confirm what
  you persisted.
- write_file overwrites the entire note (no partial update). If you hold only part
  of a file's content, read_file and merge before writing the full result.
- Set path explicitly and reuse the exact same path when overwriting. The
  connector also derives a path from the first-line heading, so an edited heading
  can silently rename/duplicate a note — don't rely on that. Text/Markdown only.
  Never write tokens or credentials into a note.

The full protocol is in BOOTSTRAP.md in this project's files.
```

## Setup checklist

1. Attach the Simplenote connector to the project (per-project).
1. Upload `BOOTSTRAP.md` to the project's files (the full protocol).
1. Paste the snippet above into the project's instructions field.
1. (Optional) Run `docs/connector-selftest.md` once to confirm the wiring.
