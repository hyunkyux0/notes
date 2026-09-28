import { useState } from "react";
import { useNotes } from "./useNotes";

export function NotesPanel({ vaultPath }: { vaultPath: string }) {
  const [title, setTitle] = useState("");
  const { files, note, busy, error, createNote, openNote, refreshNotes } =
    useNotes(vaultPath);

  return (
    <section
      className="notes-panel"
      aria-label="Markdown notes"
      aria-busy={busy}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (await createNote(title)) setTitle("");
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
      <button type="button" disabled={busy} onClick={() => void refreshNotes()}>
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
              onClick={() => void openNote(filename)}
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
