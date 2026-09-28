import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

type Status = { configured: boolean; connected: boolean; connecting: boolean };

export function GoogleConnection() {
  const [status, setStatus] = useState<Status | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(false);
  const loading = useRef(false);
  const desktop = isTauri();
  const refresh = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const next = await invoke<Status>("get_google_connection");
      if (mounted.current) {
        setStatus(next);
        setLoadError(null);
      }
    } catch (reason) {
      if (mounted.current) setLoadError(String(reason));
    } finally {
      loading.current = false;
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    if (!desktop) return;
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 2000);
    const focus = () => {
      void refresh();
    };
    window.addEventListener("focus", focus);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [desktop, refresh]);

  async function perform(command: string) {
    setAction(command);
    setError(null);
    setMessage(null);
    try {
      const result = await invoke<unknown>(command);
      if (mounted.current)
        setMessage(typeof result === "string" ? result : null);
    } catch (reason) {
      if (mounted.current) setError(String(reason));
    } finally {
      if (mounted.current) {
        setAction(null);
        void refresh();
      }
    }
  }

  const connecting = status?.connecting || action === "connect_google";
  const busy = !!action || !!connecting;
  return (
    <section aria-label="Google connection">
      <h2>Google Calendar connection</h2>
      <p>
        Connect for future review reminders on an app-created calendar. No
        calendars or events are created yet.
      </p>
      {!desktop ? (
        <p>Open the desktop app to connect Google.</p>
      ) : (
        <>
          {loadError && <p role="alert">{loadError}</p>}
          {error && <p role="alert">{error}</p>}
          {message && <p role="status">{message}</p>}
          <p>
            {connecting
              ? "Waiting for Google sign-in in your browser…"
              : status?.connected
                ? "Google credentials saved on this device."
                : status?.configured
                  ? "Ready to connect Google."
                  : "Import a Google Cloud Desktop app OAuth client JSON to configure sign-in."}
          </p>
          <button
            type="button"
            disabled={busy || !status || status.connected}
            onClick={() => {
              void perform("import_google_client");
            }}
          >
            Import Google client JSON
          </button>
          <button
            type="button"
            disabled={busy || !status?.configured || status.connected}
            onClick={() => {
              void perform("connect_google");
            }}
          >
            Connect Google
          </button>
          {connecting && (
            <button
              type="button"
              onClick={() => {
                void invoke("cancel_google_sign_in").catch((reason) =>
                  setError(String(reason)),
                );
              }}
            >
              Cancel Google sign-in
            </button>
          )}
          {status?.connected && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void perform("disconnect_google");
              }}
            >
              Disconnect Google
            </button>
          )}
        </>
      )}
    </section>
  );
}
