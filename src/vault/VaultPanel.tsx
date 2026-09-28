import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import { NotesPanel } from "../notes/NotesPanel";

type Vault = { path: string };

export function VaultPanel({ showNotes = false }: { showNotes?: boolean }) {
  const desktop = isTauri();
  const [vault, setVault] = useState<Vault | null>(null);
  const [busy, setBusy] = useState(desktop);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    invoke<Vault | null>("get_vault")
      .then((saved) => {
        if (active) setVault(saved);
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
  }, [desktop]);

  async function choose() {
    setBusy(true);
    try {
      const selected = await invoke<Vault | null>("choose_vault");
      if (selected) {
        setVault(selected);
        setError(null);
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="vault-panel" aria-busy={busy}>
        <h2>Your notes folder</h2>
        <p className="vault-path" aria-live="polite">
          {vault?.path ?? "Choose a folder to use as your vault."}
        </p>
        {error && <p role="alert">{error}</p>}
        <button
          type="button"
          className="primary-button"
          onClick={choose}
          disabled={busy || !desktop}
        >
          {busy ? "Please wait…" : vault ? "Change folder" : "Choose folder"}
        </button>
        <p className="vault-hint">
          {desktop
            ? "Your selection is remembered on this computer. Existing files stay where they are."
            : "Open the desktop app to choose a local folder."}
        </p>
      </div>
      {showNotes && vault && !busy && (
        <NotesPanel key={vault.path} vaultPath={vault.path} />
      )}
    </>
  );
}
