import type { BrowserRunState } from "./browserRunStatus";

export const MAX_ATTEMPTS = 8;
export const retryDelay = (attempt: number) => 3000 * attempt;

// Server run states that show a submission was received, even if its reply never reached this tab.
const RECEIVED = new Set(["pending", "running", "live", "completed", "torn-down"]);

export interface DeliveryDeps {
  send: () => Promise<void>;
  // The run's status on the server, used to tell a lost reply from a run the server closed.
  currentStatus: () => Promise<string>;
  sleep: (ms: number) => Promise<void>;
  report: (state: BrowserRunState) => void;
}

const statusOf = (error: unknown) => (error as { response?: { status?: number } }).response?.status;

function whyNotSent(status: number | undefined) {
  if (status === undefined) return "The server could not be reached.";
  if (status === 429) return "The server is busy replaying other runs.";
  return "The server had a problem receiving it.";
}

/** Sends a finished run, retrying brief outages and a busy replay queue. Says truthfully what happened:
"accepted" only when the server holds the submission, otherwise why not. A reply can be lost after the server accepted
the run, and a busy server answers 429 even for a run it already holds, so after any failure that is not a definite
refusal the run's real status on the server is read before anything is concluded. */
export async function deliver(deps: DeliveryDeps, { cancel = false }: { cancel?: boolean } = {}): Promise<"accepted" | "closed" | "unsent"> {
  const stoppedEarly = { kind: "closed" as const, reason: "You stopped this run before its first simulated second, so nothing was recorded." };
  let busy = false;
  for (let attempt = 1; ; attempt++) {
    deps.report({ kind: "sending", attempt, busy });
    try {
      await deps.send();
      deps.report(cancel ? stoppedEarly : { kind: "accepted" });
      return cancel ? "closed" : "accepted";
    } catch (error) {
      const status = statusOf(error);
      busy = status === 429;
      if (cancel && status === 409) { deps.report(stoppedEarly); return "closed"; }
      if (status === 401) {
        // The run is still here; only the sign-in ended. Sending again after signing in can work.
        deps.report({ kind: "unsent", reason: "Your sign-in has ended. Sign in again, then send the run again." });
        return "unsent";
      }
      if (status !== undefined && status < 500 && status !== 429 && status !== 409) {
        // Malformed or missing: sending the same thing again cannot help.
        deps.report({ kind: "closed", reason: `The server refused this run (error ${status}), so nothing was saved.` });
        return "closed";
      }
      if (!cancel) {
        // No reply, busy, a server error or "not waiting": the server may still hold the run, so ask it.
        const current = await deps.currentStatus().catch(() => null);
        if (current && RECEIVED.has(current)) { deps.report({ kind: "accepted" }); return "accepted"; }
        if (current === "failed") {
          deps.report({ kind: "closed", reason: "The server closed this run before your result arrived. A run has to reach the server within 30 minutes of starting." });
          return "closed";
        }
      }
      if (attempt >= MAX_ATTEMPTS) { deps.report({ kind: "unsent", reason: whyNotSent(status) }); return "unsent"; }
      await deps.sleep(retryDelay(attempt));
    }
  }
}

/** How long to wait before stopping a run by itself so its result still reaches the server before the cutoff. */
export const autoStopDelay = (remainingMs: number, marginMs: number) => Math.max(0, remainingMs - marginMs);
