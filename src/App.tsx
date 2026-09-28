import { invoke, isTauri } from "@tauri-apps/api/core";
import { type ReactNode, useEffect, useState } from "react";
import { NotesPanel } from "./notes/NotesPanel";

type Vault = { path: string };
type Section = "Notebook" | "Reviews" | "Settings";

export function App() {
  const [section, setSection] = useState<Section>("Notebook");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(280);
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

  const vaultName =
    vault?.path.split(/[\\/]/).filter(Boolean).at(-1) || vault?.path;
  function resizeSidebar(width: number) {
    setSidebarWidth(Math.max(200, Math.min(480, width)));
  }

  // NotesPanel keeps shared note state; this callback places its navigation and editor
  // in the workspace without duplicating that state or moving it through a global store.
  function renderWorkspace(navigation: ReactNode, editor: ReactNode) {
    return (
      <div className="workspace">
        <a className="skip-link" href="#content">
          Skip to content
        </a>
        <aside
          id="vault-sidebar"
          aria-label="Vault sidebar"
          hidden={!sidebarOpen}
          style={{ width: sidebarWidth }}
        >
          <div className="vault-control" aria-busy={busy}>
            <button
              type="button"
              className="vault-switch"
              title={vault ? `Switch vault: ${vault.path}` : "Open vault"}
              aria-label={vault ? `Switch vault: ${vaultName}` : "Open vault"}
              onClick={choose}
              disabled={busy || !desktop}
            >
              <strong>{vaultName || "Open vault"}</strong>
              <span aria-hidden="true"> ▾</span>
            </button>
            {busy && <p>Opening vault…</p>}
            {error && <p role="alert">{error}</p>}
            {!desktop && (
              <p className="vault-hint">
                Open the desktop app to choose a local folder.
              </p>
            )}
          </div>
          {navigation}
          <button
            type="button"
            className="reviews-link"
            aria-pressed={section === "Reviews"}
            onClick={() => setSection("Reviews")}
          >
            Reviews
          </button>
          <button
            type="button"
            className="sidebar-resizer"
            aria-label="Resize sidebar"
            title="Drag to resize; use left and right arrow keys when focused"
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                resizeSidebar(
                  sidebarWidth + (event.key === "ArrowLeft" ? -20 : 20),
                );
              }
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                resizeSidebar(event.clientX);
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
          />
        </aside>
        <main id="content" tabIndex={-1}>
          <header>
            <button
              type="button"
              className="icon-button"
              aria-controls="vault-sidebar"
              aria-expanded={sidebarOpen}
              aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              ☰
            </button>
            <button
              type="button"
              aria-pressed={section === "Notebook"}
              onClick={() => setSection("Notebook")}
            >
              Notebook
            </button>
            <button
              type="button"
              className="icon-button settings-button"
              aria-label="Settings"
              title="Settings"
              aria-pressed={section === "Settings"}
              onClick={() =>
                setSection(section === "Settings" ? "Notebook" : "Settings")
              }
            >
              ⚙
            </button>
          </header>
          {/* Hide auxiliary views without unmounting the editor or interrupting saves. */}
          <div className="editor-pane" hidden={section !== "Notebook"}>
            {editor}
          </div>
          {section === "Settings" && (
            <section className="welcome">
              <h1>Settings</h1>
              <p>
                Calendar, review-time, and notification settings are coming
                later.
              </p>
            </section>
          )}
          {section === "Reviews" && (
            <section className="welcome">
              <h1>Reviews</h1>
              <p>
                Return to your notes after 3, 7, and 30 days. Review scheduling
                and Google Calendar connection are planned for later milestones.
              </p>
            </section>
          )}
        </main>
      </div>
    );
  }

  return vault ? (
    <NotesPanel
      key={vault.path}
      vaultPath={vault.path}
      renderWorkspace={renderWorkspace}
      onOpenNote={() => setSection("Notebook")}
    />
  ) : (
    renderWorkspace(
      null,
      <p className="welcome">
        {busy
          ? "Opening vault…"
          : "Open a vault from the sidebar to start writing."}
      </p>,
    )
  );
}
