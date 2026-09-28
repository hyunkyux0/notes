import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

import { draftFilenames, draftKey, readDraft } from "./noteDrafts";

export type Note = {
  filename: string;
  id: string | null;
  content: string;
  reviewWarning?: string;
};
async function listVaultContents(vaultPath: string) {
  const listing = await invoke<{ files: string[]; folders: string[] }>(
    "list_vault_contents",
    { vaultPath },
  );
  return {
    ...listing,
    files: [
      ...new Set([...listing.files, ...draftFilenames(vaultPath)]),
    ].sort(),
  };
}

// App keys this feature by vault path, giving each vault isolated state.
export function useNotes(vaultPath: string) {
  const [folders, setFolders] = useState<string[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [note, setNote] = useState<Note | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(true);

  useEffect(() => {
    let active = true;
    listVaultContents(vaultPath)
      .then((names) => {
        if (active) {
          setFiles(names.files);
          setFolders(names.folders);
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(String(reason));
      })
      .finally(() => {
        if (active) {
          pending.current = false;
          setBusy(false);
        }
      });
    return () => {
      active = false;
    };
  }, [vaultPath]);

  useEffect(() => {
    let active = true;
    const refreshListing = () => {
      void listVaultContents(vaultPath)
        .then((listing) => {
          if (!active) return;
          setFiles(listing.files);
          setFolders(listing.folders);
        })
        .catch(() => {});
    };
    window.addEventListener("focus", refreshListing);
    return () => {
      active = false;
      window.removeEventListener("focus", refreshListing);
    };
  }, [vaultPath]);

  async function performVaultOperation(
    action: () => Promise<void>,
  ): Promise<boolean> {
    // A ref closes the gap before React renders disabled controls.
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (reason) {
      setError(String(reason));
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function createNote(title: string, folder: string) {
    return performVaultOperation(async () => {
      const created = await invoke<Note>("create_note", {
        vaultPath,
        title,
        folder,
      });
      setFiles((current) => [...current, created.filename].sort());
      setNote(created);
    });
  }

  function createFolder(parent: string, name: string) {
    return performVaultOperation(async () => {
      const path = await invoke<string>("create_folder", {
        vaultPath,
        parent,
        name,
      });
      setFolders((current) => [...new Set([...current, path])].sort());
    });
  }

  function openNote(filename: string) {
    return performVaultOperation(async () => {
      setNote(null);
      try {
        setNote(await invoke<Note>("read_note", { vaultPath, filename }));
      } catch (reason) {
        const recovery = readDraft(draftKey(vaultPath, filename));
        if (!recovery) throw reason;
        setNote({ filename, id: null, content: recovery.expected });
        setError(
          "The disk file is unavailable. Showing its recovery draft so you can copy it.",
        );
      }
    });
  }

  function refreshNotes() {
    return performVaultOperation(async () => {
      setNote(null);
      const listing = await listVaultContents(vaultPath);
      setFiles(listing.files);
      setFolders(listing.folders);
    });
  }

  function acceptRenamedNote(previousFilename: string, renamed: Note) {
    setFiles((current) =>
      current
        .map((name) => (name === previousFilename ? renamed.filename : name))
        .sort(),
    );
    setNote((current) =>
      current?.filename === previousFilename ? renamed : current,
    );
  }

  return {
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
  };
}
