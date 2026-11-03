import { LIFETIME_WARNING_MS, type BrowserRunState } from "./browserRunStatus";
import { MAX_ATTEMPTS } from "./browserRunDelivery";

export interface BrowserRunMessage {
  tone: "info" | "warn" | "fail";
  title: string;
  body: string;
  // What the learner can do about it.
  action?: "send-again" | "leave";
}

const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

/** What to tell the learner about the run in their tab, or null when there is nothing to say. Never claims a run is
saved or verified unless the server has accepted it. */
export function describeBrowserRun(state: BrowserRunState | undefined, remainingMs: number | null): BrowserRunMessage | null {
  if (!state) return null;
  switch (state.kind) {
    case "starting":
      return state.problem ? { tone: "warn", title: "The simulation has not started yet", body: `${state.problem} This page keeps trying.` } : null;
    case "running":
      if (remainingMs === null || remainingMs > LIFETIME_WARNING_MS) return null;
      return { tone: "warn", title: `About ${minutes(remainingMs)} min of real time left`,
        body: "The server closes a run that has not reached it within 30 minutes of starting, even while the simulation is paused. This run will be stopped and sent automatically shortly before then so its result is kept." };
    case "sending":
      return state.busy
        ? { tone: "warn", title: "The server is busy", body: `The server is replaying other runs. Your finished run is kept in this tab and sent again automatically (attempt ${state.attempt} of ${MAX_ATTEMPTS}). Keep this tab open. It is not saved yet.` }
        : { tone: "info", title: "Sending your finished run", body: `Sending it to the server for the official replay (attempt ${state.attempt} of ${MAX_ATTEMPTS}). It is not saved until the server accepts it.` };
    case "unsent":
      return { tone: "fail", title: "Your run has not been saved", body: `${state.reason} The finished run exists only in this tab, so keep it open. It has not been verified by the server.`, action: "send-again" };
    case "closed":
      return { tone: "fail", title: "This run was not saved", body: state.reason, action: "leave" };
    case "crashed":
      return { tone: "fail", title: "The simulation stopped unexpectedly", body: `Nothing from this run was saved. ${state.reason}`, action: "leave" };
    case "accepted":
      return { tone: "info", title: "Received by the server", body: "The server is replaying your run to produce the official result. The report appears when it finishes." };
  }
}
