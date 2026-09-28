import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

import { draftFilenames, draftKey, readDraft } from "./noteDrafts";

export type Note = { filename: string; id: string | null; content: string };
async function listNotes(vaultPath: string) {
  const diskFiles = await invoke<string[]>("list_notes", { vaultPath });
  return [...new Set([...diskFiles, ...draftFilenames(vaultPath)])].sort();
}

// VaultPanel keys this feature by vault path, giving each vault isolated state.
export function useNotes(vaultPath: string) {
  const [files, setFiles] = useState<string[]>([]);
  const [note, setNote] = useState<Note | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(true);

  useEffect(() => {
    let active = true;
    listNotes(vaultPath)
      .then((names) => {
        if (active) setFiles(names);
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

  async function run(action: () => Promise<void>): Promise<boolean> {
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

  function createNote(title: string) {
    return run(async () => {
      const created = await invoke<Note>("create_note", { vaultPath, title });
      setFiles((current) => [...current, created.filename].sort());
      setNote(created);
    });
  }

  function openNote(filename: string) {
    return run(async () => {
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
    return run(async () => {
      setNote(null);
      setFiles(await listNotes(vaultPath));
    });
  }

  return { files, note, busy, error, createNote, openNote, refreshNotes };
}
