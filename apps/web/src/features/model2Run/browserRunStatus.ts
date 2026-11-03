import { create } from "zustand";
import type { RunSubmission } from "./protocol";

/* What the learner needs to know about a run that lives in this tab. The simulation itself runs in a worker; this
records whether its result reached the server, because only the server's replay is the official record. */
export type BrowserRunState =
  // The simulation is being started in this tab. "problem" says why the last start failed; starting is retried.
  | { kind: "starting"; problem?: string }
  | { kind: "running" }
  // The finished run is being sent. "busy" means the server answered that its replay slots are full.
  | { kind: "sending"; attempt: number; busy: boolean }
  // Every attempt failed. The run exists only in this tab and can be sent again from here.
  | { kind: "unsent"; reason: string }
  // The server accepted the run and is replaying it for the official result.
  | { kind: "accepted" }
  // The server is no longer waiting for this run (it closed it), so nothing was saved.
  | { kind: "closed"; reason: string }
  // The simulation stopped unexpectedly in this browser.
  | { kind: "crashed"; reason: string };

interface Store {
  runs: Record<string, BrowserRunState>;
  // Real-time moment (performance.now) after which the server closes an unsent browser run.
  deadlines: Record<string, number>;
  set: (id: string, state: BrowserRunState) => void;
  setDeadline: (id: string, at: number) => void;
  clear: (id: string) => void;
}

export const useBrowserRunStatus = create<Store>((set) => ({
  runs: {}, deadlines: {},
  set: (id, state) => set((s) => ({ runs: { ...s.runs, [id]: state } })),
  setDeadline: (id, at) => set((s) => ({ deadlines: { ...s.deadlines, [id]: at } })),
  clear: (id) => set((s) => {
    const runs = { ...s.runs }, deadlines = { ...s.deadlines };
    delete runs[id]; delete deadlines[id];
    return { runs, deadlines };
  }),
}));

// A finished run kept in memory so "Send again" does not need the worker. It is dropped once the server accepts it.
const unsent = new Map<string, RunSubmission>();
export const keepUnsent = (id: string, submission: RunSubmission) => { unsent.set(id, submission); };
export const takeUnsent = (id: string) => unsent.get(id);
export const dropUnsent = (id: string) => { unsent.delete(id); };

export const browserRunState = (id: string) => useBrowserRunStatus.getState().runs[id];

/** The plain reason a run's controls cannot act, or null when the run is still running in this tab. */
export function browserRunProblem(id: string): string | null {
  const state = browserRunState(id);
  if (!state || state.kind === "running") return null;
  if (state.kind === "starting") return "The simulation is still starting in this browser.";
  if (state.kind === "crashed") return "This run stopped unexpectedly in your browser and cannot be controlled any more. Nothing from it was saved.";
  if (state.kind === "closed") return "The server has closed this run, so it can no longer be controlled. Nothing from it was saved.";
  if (state.kind === "unsent") return "This run has finished. It has not reached the server yet; use Send again.";
  return "This run has finished and is being replayed by the server.";
}

// One minute and a half is enough to stop the worker and deliver a submission before the server's cutoff.
export const AUTO_STOP_MARGIN_MS = 90_000;
// Warn this long before the cutoff.
export const LIFETIME_WARNING_MS = 10 * 60_000;

/** Whether this tab should show a snapshot the server published for the run. A tab that ran the simulation itself already
shows the run. The server's official replay of it restarts at second 0 and would rewind the learner's screen. */
export const acceptsServerSnapshot = (state: BrowserRunState | undefined) => state === undefined;
