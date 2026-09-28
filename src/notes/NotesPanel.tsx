import { useState } from "react";
import { NoteEditor } from "./NoteEditor";
import { useNotes } from "./useNotes";

export function NotesPanel({ vaultPath }: { vaultPath: string }) {
  const [selectedFolder, setSelectedFolder] = useState("");
  const [folderName, setFolderName] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [title, setTitle] = useState("");
  const {
    folders,
    createFolder,
    files,
    note,
    busy,
    error,
    createNote,
    openNote,
    refreshNotes,
    acceptRenamedNote,
  } = useNotes(vaultPath);

  // Include parents of recovery drafts even when their disk folders have disappeared.
  const treeFolders = new Set(folders);
  for (const path of [...folders, ...files]) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++)
      treeFolders.add(parts.slice(0, i).join("/"));
  }
  const parentOf = (path: string) =>
    path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  function folderContents(parent: string) {
    return (
      <ul>
        {[...treeFolders]
          .filter((path) => parentOf(path) === parent)
          .sort()
          .map((path) => (
            <li key={path}>
              <button
                type="button"
                disabled={busy}
                aria-label={`Folder ${path}`}
                aria-expanded={expandedFolders.has(path)}
                aria-pressed={selectedFolder === path}
                onClick={() => {
                  setSelectedFolder(path);
                  setExpandedFolders((current) => {
                    const next = new Set(current);
                    if (next.has(path)) next.delete(path);
                    else next.add(path);
                    return next;
                  });
                }}
              >
                {expandedFolders.has(path) ? "▾" : "▸"} {path.split("/").at(-1)}
              </button>
              {expandedFolders.has(path) && folderContents(path)}
            </li>
          ))}
        {files
          .filter((path) => parentOf(path) === parent)
          .map((path) => (
            <li key={path}>
              <button
                type="button"
                disabled={busy}
                aria-label={path}
                aria-pressed={note?.filename === path}
                onClick={() => {
                  setSelectedFolder(parent);
                  void openNote(path);
                }}
              >
                {path.split("/").at(-1)}
              </button>
            </li>
          ))}
      </ul>
    );
  }

  return (
    <section
      className="notes-panel"
      aria-label="Markdown notes"
      aria-busy={busy}
    >
      <p>
        New notes and folders will be created in:{" "}
        <strong>{selectedFolder || "Vault root"}</strong>
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (await createFolder(selectedFolder, folderName)) {
            setFolderName("");
            setExpandedFolders(
              (current) => new Set([...current, selectedFolder]),
            );
          }
        }}
      >
        <label htmlFor="folder-name">New folder name</label>
        <input
          id="folder-name"
          value={folderName}
          required
          maxLength={200}
          disabled={busy}
          onChange={(event) => setFolderName(event.target.value)}
        />
        <button type="submit" disabled={busy || !folderName.trim()}>
          Create folder
        </button>
      </form>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (await createNote(title, selectedFolder)) {
            setTitle("");
            setExpandedFolders(
              (current) => new Set([...current, selectedFolder]),
            );
          }
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
        <p>No Markdown notes in this vault yet.</p>
      )}
      <nav className="note-list" aria-label="Vault files and folders">
        <button
          type="button"
          disabled={busy}
          aria-pressed={selectedFolder === ""}
          onClick={() => setSelectedFolder("")}
        >
          Vault root
        </button>
        {folderContents("")}
      </nav>
      {note && (
        <NoteEditor
          key={JSON.stringify([vaultPath, note.filename])}
          note={note}
          vaultPath={vaultPath}
          onRenamed={acceptRenamedNote}
        />
      )}
    </section>
  );
}
