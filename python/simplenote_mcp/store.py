"""Simplenote-backed file store for the MCP connector.

A "project" is a set of Simplenote notes that share one scope **tag**
(e.g. ``claude-project-<id>``). Each note is addressed as a *file* whose path is
the slug of its first-line heading — the same first-line-heading↔filename
convention used by the ``sn`` CLI (../simplenote-sync), so notes round-trip
between the two tools and the user's phone.

The store is intentionally **stateless**: there is no local ``state.json`` and
no notes directory. The path→note index is rebuilt from the live note list on
every call, because each MCP tool invocation may run in a fresh process and a
different conversation. Writes are last-writer-wins per file (the latest remote
version is fetched immediately before update), which matches the ``sn`` tool's
"no interactive merge" philosophy.

Network note: this talks directly to the Simperium API
(``auth.simperium.com`` / ``api.simperium.com``), which is **not** reachable
from inside a Claude.ai project sandbox (allow-listed egress). Run it as an
external remote connector, never in-sandbox.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from simplenote import Simplenote

#: Simplenote system tag that marks a note as Markdown (renders as Markdown in
#: the Simplenote apps). Mirrors ``sn.py``'s behaviour for ``*.md`` notes.
MARKDOWN_SYSTEM_TAG = "markdown"


def slugify(title: str) -> str:
    """Convert a first-line heading to a safe path stem (no ``.md``).

    Mirrors ``sn.py``'s ``_slugify`` so filenames are identical across tools.
    Keeps word characters, CJK ranges and hyphens; collapses whitespace to
    ``-``; caps length at 80.
    """
    title = re.sub(r"^#+\s*", "", title).strip()
    if not title:
        return ""
    title = re.sub(r"[^\w\s一-鿿㐀-䶿\-]", "", title)
    title = re.sub(r"\s+", "-", title).strip("-")
    return title[:80]


def _as_float(value) -> float:
    """Coerce a Simperium date field (float or numeric string) to float."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def note_path(note: dict, taken: set[str]) -> str:
    """Derive a unique ``.md`` path for a note, avoiding collisions in ``taken``."""
    content = note.get("content", "") or ""
    first_line = content.split("\n", 1)[0].strip() if content else ""
    stem = slugify(first_line) or note["key"][:8]
    name = f"{stem}.md"
    counter = 1
    while name in taken:
        name = f"{stem}-{counter}.md"
        counter += 1
    return name


@dataclass
class FileMeta:
    """Lightweight description of one persisted file (note)."""

    path: str
    key: str
    version: int
    modified: float
    tags: list[str]


class SimplenoteError(RuntimeError):
    """Raised when the Simperium backend rejects an operation."""


class SimplenoteStore:
    """A file-like view over the Simplenote notes carrying one project tag."""

    def __init__(self, token: str, project_tag: str):
        if not token:
            raise ValueError("SIMPLENOTE_TOKEN is required")
        if not project_tag:
            raise ValueError("SIMPLENOTE_PROJECT_TAG is required")
        self.project_tag = project_tag
        self._sn = Simplenote("_", "_")
        # Token-only auth: the library needs dummy credentials at construction,
        # then we inject the real API token (same pattern as sn.py:_client).
        self._sn.token = token

    # ── internal ────────────────────────────────────────────────

    def _list_notes(self) -> list[dict]:
        """All non-deleted notes carrying the project tag."""
        notes, status = self._sn.get_note_list(data=True, tags=[self.project_tag])
        if status != 0:
            raise SimplenoteError("failed to list notes from Simplenote")
        # Defensive client-side filter: don't trust the server tag filter alone,
        # and drop trashed notes.
        return [
            n
            for n in notes
            if not n.get("deleted", False)
            and self.project_tag in (n.get("tags") or [])
        ]

    def _index(self) -> dict[str, FileMeta]:
        """Build the path→FileMeta map. Sorted by creation date so collision
        suffixes (``-1``, ``-2``) are stable across calls."""
        taken: set[str] = set()
        index: dict[str, FileMeta] = {}
        for note in sorted(self._list_notes(), key=lambda n: _as_float(n.get("creationDate"))):
            path = note_path(note, taken)
            taken.add(path)
            index[path] = FileMeta(
                path=path,
                key=note["key"],
                version=int(note.get("version", 0) or 0),
                modified=_as_float(note.get("modificationDate")),
                tags=list(note.get("tags") or []),
            )
        return index

    def _meta_from_result(self, path: str, note: dict) -> FileMeta:
        return FileMeta(
            path=path,
            key=note["key"],
            version=int(note.get("version", 0) or 0),
            modified=_as_float(note.get("modificationDate")),
            tags=list(note.get("tags") or []),
        )

    # ── public API ──────────────────────────────────────────────

    def list_files(self) -> list[FileMeta]:
        """All persisted files for this project, sorted by path."""
        return sorted(self._index().values(), key=lambda m: m.path)

    def read_file(self, path: str) -> str:
        """Return the full content of a persisted file.

        Raises ``FileNotFoundError`` if no file with that path exists.
        """
        meta = self._index().get(path)
        if meta is None:
            raise FileNotFoundError(path)
        note, status = self._sn.get_note(meta.key)
        if status != 0:
            raise SimplenoteError(f"failed to read {path}")
        return note.get("content", "") or ""

    def write_file(self, path: str, content: str) -> FileMeta:
        """Create or overwrite a persisted file.

        If ``path`` already maps to a note, the note is updated at its latest
        version (last-writer-wins) while preserving its existing user tags and
        ensuring the project tag and Markdown system tag are present. Otherwise
        a new note is created carrying the project tag.

        The note's *content* drives its title/path: if ``content`` has a
        different first-line heading than ``path``, the file is effectively
        renamed on the next ``list_files`` (same coupling as the ``sn`` tool).
        """
        meta = self._index().get(path)
        if meta is not None:
            # Re-fetch to get the freshest version for optimistic concurrency.
            current, status = self._sn.get_note(meta.key)
            if status != 0:
                raise SimplenoteError(f"failed to fetch {path} before write")
            tags = list(current.get("tags") or [])
            if self.project_tag not in tags:
                tags.append(self.project_tag)
            update = {
                "key": meta.key,
                "content": content,
                "tags": tags,
                "version": current.get("version"),
                "systemTags": _with_markdown(current.get("systemTags")),
            }
            result, status = self._sn.update_note(update)
            if status != 0:
                raise SimplenoteError(f"failed to write {path}")
        else:
            result, status = self._sn.add_note(
                {
                    "content": content,
                    "tags": [self.project_tag],
                    "systemTags": [MARKDOWN_SYSTEM_TAG],
                }
            )
            if status != 0:
                raise SimplenoteError(f"failed to create {path}")
        return self._meta_from_result(path, result)

    def delete_file(self, path: str) -> None:
        """Soft-delete (trash) a persisted file. Raises ``FileNotFoundError``
        if it does not exist."""
        meta = self._index().get(path)
        if meta is None:
            raise FileNotFoundError(path)
        _, status = self._sn.trash_note(meta.key)
        if status != 0:
            raise SimplenoteError(f"failed to delete {path}")


def _with_markdown(system_tags) -> list[str]:
    """Return ``system_tags`` with the Markdown system tag guaranteed present."""
    tags = list(system_tags or [])
    if MARKDOWN_SYSTEM_TAG not in tags:
        tags.append(MARKDOWN_SYSTEM_TAG)
    return tags
