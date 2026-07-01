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
(tools: list_files, read_file, write_file, delete_file). Simplenote is the durable
store; the sandbox is per-conversation and disposable.

- Start of every conversation: call list_files to see persisted state, then
  read_file only the files this task needs.
- Before finishing, or whenever I say "save"/"persist": write_file every new or
  changed file back, and delete_file anything I want removed. Briefly confirm
  what you persisted.
- The first-line heading owns the path (path = slug of the heading); keep them
  consistent. Text/Markdown only. Never write tokens or credentials into a note.

The full protocol is in BOOTSTRAP.md in this project's files.
```

## Setup checklist

1. Attach the Simplenote connector to the project (per-project).
1. Upload `BOOTSTRAP.md` to the project's files (the full protocol).
1. Paste the snippet above into the project's instructions field.
1. (Optional) Run `docs/connector-selftest.md` once to confirm the wiring.
