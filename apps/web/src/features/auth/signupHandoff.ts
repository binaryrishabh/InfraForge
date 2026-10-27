import { useEffect, useRef, useState } from "react";
import { isAxiosError } from "axios";
import { normalizeUsername, validUsername } from "@infraforge/contracts/auth";
import { API_URL, http } from "../../client/httpClient";

// Signup continues on the device where it started: the first request sets an
// HttpOnly handoff cookie, the emailed link confirms it (on any device) and the
// waiting tab picks the confirmation up by polling. The proof never enters storage.
export type HandoffStatus = { state: "pending" } | { state: "expired" } | { state: "confirmed"; email: string; emailProof: string };

export async function confirmHandoff(emailProof: string): Promise<{ email: string }> {
  return (await http.post<{ email: string }>(`${API_URL}/auth/signup-handoff/confirm`, { emailProof })).data;
}
export async function handoffStatus(signal?: AbortSignal): Promise<HandoffStatus> {
  return (await http.get<HandoffStatus>(`${API_URL}/auth/signup-handoff/status`, { signal })).data;
}

/* Polls while `active`: every 3 s while the tab is visible, every 10 s while hidden,
and at once when the person comes back to this tab (for example from their phone). */
export function useHandoff(active: boolean, onConfirmed: (email: string, emailProof: string) => void, onExpired: () => void) {
  const callbacks = useRef({ onConfirmed, onExpired });
  useEffect(() => { callbacks.current = { onConfirmed, onExpired }; });
  useEffect(() => {
    if (!active) return;
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController();
    const check = async () => {
      clearTimeout(timer);
      try {
        const status = await handoffStatus(abort.signal);
        if (stopped) return;
        if (status.state === "confirmed") { stopped = true; callbacks.current.onConfirmed(status.email, status.emailProof); return; }
        if (status.state === "expired") { stopped = true; callbacks.current.onExpired(); return; }
      } catch { /* Network blips are retried on the next tick. */ }
      if (!stopped) timer = setTimeout(() => void check(), document.hidden ? 10000 : 3000);
    };
    const visible = () => { if (!document.hidden && !stopped) void check(); };
    document.addEventListener("visibilitychange", visible);
    void check();
    return () => { stopped = true; clearTimeout(timer); abort.abort(); document.removeEventListener("visibilitychange", visible); };
  }, [active]);
}

export type UsernameState = "idle" | "invalid" | "checking" | "available" | "taken" | "unknown";
/* Debounced availability while typing: 400 ms after the last keystroke, cancelling
any older request so a slow answer can never overwrite a newer one. */
export function useUsernameAvailability(username: string, delay = 400): UsernameState {
  const [result, setResult] = useState<{ name: string; state: UsernameState }>({ name: "", state: "idle" });
  const trimmed = username.trim();
  const valid = validUsername(trimmed);
  useEffect(() => {
    if (!valid) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      http.post<{ available: boolean }>(`${API_URL}/auth/is-username-available`, { username: normalizeUsername(trimmed) }, { signal: abort.signal })
        .then(({ data }) => setResult({ name: trimmed, state: data.available ? "available" : "taken" }))
        .catch((error) => { if (!isAxiosError(error) || error.code !== "ERR_CANCELED") setResult({ name: trimmed, state: "unknown" }); });
    }, delay);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [trimmed, valid, delay]);
  if (!trimmed) return "idle";
  if (!valid) return "invalid";
  return result.name === trimmed ? result.state : "checking";
}
