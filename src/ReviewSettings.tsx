import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

type Preferences = { intervals: number[]; alertTime: string; timezone: string };
type Snapshot = { preferences: Preferences; revision: string | null };
type Form = { intervals: string; alertTime: string; timezone: string };
const asForm = (values: Preferences): Form => ({
  ...values,
  intervals: values.intervals.join(", "),
});

export function ReviewSettings() {
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const saved = useRef<Snapshot | null>(null);
  const dirty = useRef(false);
  const saving = useRef(false);
  const mounted = useRef(false);
  const request = useRef(0);
  const reading = useRef<number | null>(null);

  const reload = useCallback(async (discard = false) => {
    if (saving.current || (reading.current !== null && !discard)) return;
    const id = ++request.current;
    reading.current = id;
    if (discard) setBusy(true);
    try {
      const snapshot = await invoke<Snapshot>("get_review_settings");
      if (!mounted.current || id !== request.current) return;
      if (dirty.current && !discard) {
        setChangedElsewhere(snapshot.revision !== saved.current?.revision);
        return;
      }
      saved.current = snapshot;
      dirty.current = false;
      setForm(asForm(snapshot.preferences));
      setChangedElsewhere(false);
      setError(null);
    } catch (reason) {
      if (mounted.current && id === request.current) setError(String(reason));
    } finally {
      if (reading.current === id) reading.current = null;
      if (discard && mounted.current && id === request.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void reload();
    const refresh = () => {
      void reload();
    };
    // Poll only while Settings is open; focus refresh also catches suspended windows.
    const timer = window.setInterval(refresh, 2000);
    window.addEventListener("focus", refresh);
    return () => {
      mounted.current = false;
      request.current++;
      reading.current = null;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [reload]);

  function edit(field: keyof Form, value: string) {
    dirty.current = true;
    setMessage("");
    setForm((current) => current && { ...current, [field]: value });
  }

  async function save() {
    if (!form || !saved.current || saving.current) return;
    setError(null);
    setMessage("");
    // Only parse the form here. Domain validation remains in the native scheduling core.
    if (!/^\s*\d+\s*(,\s*\d+\s*)*$/.test(form.intervals)) {
      setError("Enter review intervals as comma-separated whole numbers.");
      return;
    }
    const intervals = form.intervals.split(",").map(Number);
    if (
      intervals.some(
        (value) => !Number.isSafeInteger(value) || value > 4294967295,
      )
    ) {
      setError("Review intervals are too large.");
      return;
    }
    saving.current = true;
    setBusy(true);
    request.current++;
    try {
      const snapshot = await invoke<Snapshot>("save_review_settings", {
        preferences: { ...form, intervals },
        expectedRevision: saved.current.revision,
      });
      if (!mounted.current) return;
      saved.current = snapshot;
      dirty.current = false;
      setForm(asForm(snapshot.preferences));
      setChangedElsewhere(false);
      setMessage("Review settings saved.");
    } catch (reason) {
      if (mounted.current) setError(String(reason));
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section className="welcome review-settings">
      <h1>Settings</h1>
      <h2>Review reminders</h2>
      <p>
        These settings apply to all vaults and windows. Save them before a
        note’s first content save to enable local review dates. Existing
        schedules are unchanged. Calendar reminders are not active yet.
      </p>
      {error && <p role="alert">{error}</p>}
      {changedElsewhere && (
        <p role="alert">
          Settings changed in another window. Reload saved settings to discard
          your unsaved settings and use the latest values.
        </p>
      )}
      {form ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy}>
            <label>
              Review intervals (days)
              <input
                value={form.intervals}
                onChange={(event) => edit("intervals", event.target.value)}
              />
            </label>
            <label>
              Alert time
              <input
                type="time"
                required
                value={form.alertTime}
                onChange={(event) => edit("alertTime", event.target.value)}
              />
            </label>
            <label>
              Timezone
              <input
                required
                placeholder="Asia/Hong_Kong"
                value={form.timezone}
                onChange={(event) => edit("timezone", event.target.value)}
              />
            </label>
            <p>
              Use an IANA timezone such as Asia/Hong_Kong or America/New_York.
              Times follow that timezone, even when you travel.
            </p>
            <button type="submit" disabled={changedElsewhere}>
              Save review settings
            </button>
          </fieldset>
        </form>
      ) : (
        !error && <p>Loading review settings…</p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setMessage("");
          void reload(true);
        }}
      >
        Reload saved settings
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
