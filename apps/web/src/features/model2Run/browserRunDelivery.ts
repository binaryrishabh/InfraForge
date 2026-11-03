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
"accepted" only when the server holds the submission, otherwise why not. */
export async function deliver(deps: DeliveryDeps, { cancel = false }: { cancel?: boolean } = {}): Promise<"accepted" | "closed" | "unsent"> {
  let busy = false;
  for (let attempt = 1; ; attempt++) {
    deps.report({ kind: "sending", attempt, busy });
    try {
      await deps.send();
      deps.report(cancel ? { kind: "closed", reason: "You stopped this run before its first simulated second, so nothing was recorded." } : { kind: "accepted" });
      return cancel ? "closed" : "accepted";
    } catch (error) {
      const status = statusOf(error);
      busy = status === 429;
      if (status === 409) {
        // The server is no longer waiting for this run. Either it already has the submission (a reply was lost) or it closed the run.
        if (cancel) { deps.report({ kind: "closed", reason: "You stopped this run before its first simulated second, so nothing was recorded." }); return "closed"; }
        const current = await deps.currentStatus().catch(() => null);
        if (current && RECEIVED.has(current)) { deps.report({ kind: "accepted" }); return "accepted"; }
        if (current === "failed") {
          deps.report({ kind: "closed", reason: "The server closed this run before your result arrived. A run has to reach the server within 30 minutes of starting." });
          return "closed";
        }
      } else if (status === 401) {
        // The run is still here; only the sign-in ended. Sending again after signing in can work.
        deps.report({ kind: "unsent", reason: "Your sign-in has ended. Sign in again, then send the run again." });
        return "unsent";
      } else if (status !== undefined && status < 500 && status !== 429) {
        // Malformed, unauthorized or missing: sending the same thing again cannot help.
        deps.report({ kind: "closed", reason: `The server refused this run (error ${status}), so nothing was saved.` });
        return "closed";
      }
      if (attempt >= MAX_ATTEMPTS) { deps.report({ kind: "unsent", reason: whyNotSent(status) }); return "unsent"; }
      await deps.sleep(retryDelay(attempt));
    }
  }
}

/** How long to wait before stopping a run by itself so its result still reaches the server before the cutoff. */
export const autoStopDelay = (remainingMs: number, marginMs: number) => Math.max(0, remainingMs - marginMs);
