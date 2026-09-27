import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

type Note = { filename: string; id: string | null; content: string };

export function NotesPanel({ vaultPath }: { vaultPath: string }) {
  const [files, setFiles] = useState<string[]>([]);
  const [note, setNote] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    invoke<string[]>("list_notes", { vaultPath })
      .then((names) => {
        if (active) setFiles(names);
      })
      .catch((reason: unknown) => {
        if (active) setError(String(reason));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [vaultPath]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="notes-panel"
      aria-label="Markdown notes"
      aria-busy={busy}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const created = await invoke<Note>("create_note", {
              vaultPath,
              title,
            });
            setFiles((current) => [...current, created.filename].sort());
            setNote(created);
            setTitle("");
          });
        }}
      >
        <label htmlFor="note-title">New note title</label>
        <input
          id="note-title"
          value={title}
          maxLength={120}
          required
          disabled={busy}
          onChange={(event) => setTitle(event.target.value)}
        />
        <button
          type="submit"
          className="primary-button"
          disabled={busy || !title.trim()}
        >
          Create note
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            setNote(null);
            setFiles(await invoke<string[]>("list_notes", { vaultPath }));
          })
        }
      >
        Refresh notes
      </button>
      {busy && <p role="status">Loading notes…</p>}
      {!busy && !error && files.length === 0 && (
        <p>No Markdown notes in this folder yet.</p>
      )}
      <ul className="note-list" aria-label="Note files">
        {files.map((filename) => (
          <li key={filename}>
            <button
              type="button"
              disabled={busy}
              aria-pressed={note?.filename === filename}
              onClick={() =>
                void run(async () => {
                  setNote(null);
                  setNote(
                    await invoke<Note>("read_note", { vaultPath, filename }),
                  );
                })
              }
            >
              {filename}
            </button>
          </li>
        ))}
      </ul>
      {note && (
        <article aria-label="Note contents">
          <h2>{note.filename}</h2>
          <p className="vault-hint">
            Read-only Markdown. Editing is coming next.
          </p>
          <pre className="note-content">{note.content}</pre>
        </article>
      )}
    </section>
  );
}
