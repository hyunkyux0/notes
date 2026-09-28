import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { MarkdownEditor } from "./MarkdownEditor";
import { type Draft, draftFilenames, draftKey, readDraft } from "./noteDrafts";
import type { Note } from "./useNotes";

// Saves outlive an editor remount; a reopened editor waits before saving again.
const pendingSaves = new Map<string, Promise<Note>>();

function draftFromNote(note: Note): Draft {
  const body = note.id
    ? note.content.includes("\n")
      ? note.content.slice(note.content.indexOf("\n") + 1)
      : ""
    : note.content;
  return { expected: note.content, savedBody: body, body };
}

// Keyed by vault and filename in NotesPanel; each editor owns its draft and save lifecycle.
export function NoteEditor({
  note,
  vaultPath,
  onRenamed,
}: {
  note: Note;
  vaultPath: string;
  onRenamed: (previousFilename: string, renamed: Note) => void;
}) {
  const key = draftKey(vaultPath, note.filename);
  const [initial] = useState(() => {
    try {
      const recovery = readDraft(key);
      const changedAfterRevert =
        recovery &&
        recovery.body === recovery.savedBody &&
        recovery.expected !== note.content &&
        !pendingSaves.has(key);
      return {
        draft: recovery ?? draftFromNote(note),
        loadFailed: false,
        error: changedAfterRevert
          ? "The disk file changed since this draft was retained. Inspect your draft before reloading."
          : null,
      };
    } catch {
      return {
        draft: draftFromNote(note),
        loadFailed: true,
        error:
          "The recovery draft cannot be loaded. Editing is paused; reload the disk version to discard it.",
      };
    }
  });
  const [draft, setDraft] = useState(initial.draft);
  const [draftLoadFailed, setDraftLoadFailed] = useState(initial.loadFailed);
  const [error, setError] = useState<string | null>(initial.error);
  const [saving, setSaving] = useState(() => pendingSaves.has(key));
  const [confirmReload, setConfirmReload] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [newFilename, setNewFilename] = useState(note.filename);
  const [importing, setImporting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const requestInFlight = useRef(false);
  const dirty = draft.body !== draft.savedBody;

  useEffect(() => {
    const pending = pendingSaves.get(key);
    if (!pending) return;
    let active = true;
    void pending
      .then((saved) => {
        if (active) setDraft(readDraft(key) ?? draftFromNote(saved));
      })
      .catch((reason: unknown) => {
        if (active) setError(String(reason));
      })
      .finally(() => {
        if (active) setSaving(false);
      });
    return () => {
      active = false;
    };
  }, [key]);

  useEffect(() => {
    if (!dirty || error || saving || reloading) return;
    const timer = window.setTimeout(() => {
      if (requestInFlight.current || pendingSaves.has(key)) return;
      requestInFlight.current = true;
      setSaving(true);
      const submitted = draft;
      const request = invoke<Note>("save_note", {
        vaultPath,
        filename: note.filename,
        expectedContent: submitted.expected,
        body: submitted.body,
      }).then((saved) => {
        // Read the latest persisted draft: typing or remounting may have happened during IPC.
        const latest = readDraft(key);
        if (latest?.expected === submitted.expected) {
          if (latest.body === submitted.body) localStorage.removeItem(key);
          else
            localStorage.setItem(
              key,
              JSON.stringify({
                ...latest,
                expected: saved.content,
                savedBody: submitted.body,
              }),
            );
        }
        return saved;
      });
      pendingSaves.set(key, request);
      void request
        .then((saved) => {
          setDraft((current) =>
            current.expected === submitted.expected
              ? {
                  ...current,
                  expected: saved.content,
                  savedBody: submitted.body,
                }
              : current,
          );
        })
        .catch((reason: unknown) => {
          setError(String(reason));
        })
        .finally(() => {
          if (pendingSaves.get(key) === request) pendingSaves.delete(key);
          requestInFlight.current = false;
          setSaving(false);
        });
    }, 750);
    return () => window.clearTimeout(timer);
  }, [draft, dirty, error, saving, reloading, key, note.filename, vaultPath]);

  function edit(body: string) {
    const next = { ...draft, body };
    try {
      // Persist before accepting an edit, so navigation/close cannot lose the draft.
      if (body === draft.savedBody && !pendingSaves.has(key))
        localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(next));
      setDraft(next);
      return true;
    } catch {
      setError(
        "This edit could not be preserved on this device. Free local storage and retry; the previous draft is retained.",
      );
      return false;
    }
  }

  async function reloadDiskVersion() {
    if (
      requestInFlight.current ||
      pendingSaves.has(key) ||
      reloading ||
      importing
    )
      return;
    setConfirmReload(false);
    setReloading(true);
    try {
      const fresh = await invoke<Note>("read_note", {
        vaultPath,
        filename: note.filename,
      });
      localStorage.removeItem(key);
      setDraft(draftFromNote(fresh));
      setDraftLoadFailed(false);
      setRenameError(null);
      setError(null);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setReloading(false);
    }
  }

  async function renameNote() {
    if (requestInFlight.current || importing) return;
    if (
      dirty ||
      saving ||
      reloading ||
      renaming ||
      error ||
      pendingSaves.has(key)
    )
      return;
    requestInFlight.current = true;
    setRenaming(true);
    setRenameError(null);
    try {
      // Refuse both source and destination drafts: neither can safely change identity here.
      const normalizeName = (name: string) =>
        name.normalize("NFC").toLowerCase();
      const protectedNames = [note.filename, newFilename].map(normalizeName);
      if (
        draftFilenames(vaultPath).some((name) =>
          protectedNames.includes(normalizeName(name)),
        )
      ) {
        throw new Error(
          "Save or discard recovery drafts for both filenames before renaming.",
        );
      }
      const renamed = await invoke<Note>("rename_note", {
        vaultPath,
        filename: note.filename,
        newFilename,
        expectedContent: draft.expected,
      });
      onRenamed(note.filename, renamed);
    } catch (reason) {
      setRenameError(String(reason));
    } finally {
      requestInFlight.current = false;
      setRenaming(false);
    }
  }

  return (
    <article aria-label="Note editor">
      <h2>{note.filename}</h2>
      <p role="status">
        {saving
          ? "Saving…"
          : error
            ? "Save paused"
            : dirty
              ? "Unsaved draft retained on this device"
              : "Saved"}
      </p>

      <MarkdownEditor
        vaultPath={vaultPath}
        filename={note.filename}
        onImportBusy={setImporting}
        value={draft.body}
        disabled={reloading || renaming || draftLoadFailed || importing}
        onEdit={edit}
      />

      {error && <p role="alert">{error}</p>}
      {error && (
        <button
          type="button"
          disabled={saving || reloading || renaming || draftLoadFailed}
          onClick={() => setError(null)}
        >
          Retry save
        </button>
      )}
      <button
        type="button"
        disabled={saving || reloading || renaming || importing}
        onClick={() =>
          dirty || error ? setConfirmReload(true) : void reloadDiskVersion()
        }
      >
        Reload disk version
      </button>
      {confirmReload && (
        <div>
          <p>
            Discard this recovery draft? Copy any text you want to keep first.
          </p>
          <button
            type="button"
            disabled={saving || reloading || renaming || importing}
            onClick={() => void reloadDiskVersion()}
          >
            Discard draft and reload
          </button>
          <button type="button" onClick={() => setConfirmReload(false)}>
            Keep draft
          </button>
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void renameNote();
        }}
      >
        <label htmlFor="rename-note">Path within vault (including .md)</label>
        <input
          id="rename-note"
          value={newFilename}
          disabled={renaming}
          onChange={(event) => setNewFilename(event.target.value)}
          required
        />
        <button
          type="submit"
          disabled={
            importing ||
            dirty ||
            saving ||
            reloading ||
            renaming ||
            !!error ||
            newFilename === note.filename
          }
        >
          Rename or move note
        </button>
        <p className="vault-hint">
          Use / to move into an existing folder. Save or discard pending changes
          first.
        </p>
        {renameError && <p role="alert">{renameError}</p>}
      </form>
    </article>
  );
}
