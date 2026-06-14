# Project persistence protocol (Simplenote)

**Add this file to the Claude project.** It lands read-only in `/mnt/project`
and is loaded into every conversation. It tells you (the assistant) how to keep
files alive across conversations using the **Simplenote connector**.

## Why this is needed

In this project, `/mnt/user-data/outputs` is writable but **per-conversation** —
nothing you write there is visible in the next conversation. The only durable,
cross-conversation store you can write to is **Simplenote, via the connector
tools**. So: pull state in at the start, push changes back before you finish.

## Prerequisite

The **Simplenote connector** must be attached to this project. You have it if
these tools exist: `list_files`, `read_file`, `write_file`, `delete_file`.
If they are missing, tell the user: *"Add the Simplenote custom connector to
this project, then we can persist files."* and stop.

## Protocol

**1 — Rehydrate (do this at the start of a conversation):**
- Call `list_files` to see what persisted state exists.
- For each file you need, call `read_file(path)` and write it into the working
  area, e.g. `/mnt/user-data/outputs/<path>`. Be selective — only pull what the
  task needs (each pulled file costs context tokens).

**2 — Work:** edit files in the sandbox as usual.

**3 — Persist (before ending, or whenever the user says "save"/"persist"):**
- For every new or changed file, call `write_file(path, content)` with the
  current content.
- For anything the user wants removed, call `delete_file(path)`.
- Briefly confirm to the user what you persisted.

## Rules

- **The first-line heading defines the path.** A file starting with
  `# Design Notes` is `Design-Notes.md`. Keep the heading and the `path`
  consistent; changing the heading renames the file.
- **Text / Markdown only.** Simplenote notes are plain text — no binaries,
  images, or attachments.
- **Scope is automatic.** Every file is tagged to this project; you only ever
  see and write this project's files.
- **Last-writer-wins.** If two conversations might have touched the same file,
  `read_file` first and merge before you `write_file`.
- **Never paste tokens or credentials** into a note, a file, or the chat. Auth
  is handled by the connector, not by you.

## Tool reference

| Tool | Use |
|---|---|
| `list_files()` | What's persisted? Returns paths + versions. |
| `read_file(path)` | Pull one file's content. |
| `write_file(path, content)` | Create/overwrite a file (persist it). |
| `delete_file(path)` | Trash a file. |
