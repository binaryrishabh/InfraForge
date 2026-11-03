import type { InterventionOption } from "@infraforge/contracts/actions";
import type { ActionRequest, RunAction } from "@infraforge/contracts/actions";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { http, API_URL } from "@/client/httpClient";
import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
import { toast } from "sonner";
import { errorMessage } from "@/api/errorMessage";
import { startModel2Run, type ActionResult } from "./runner";
import type { RunStart, RunSubmission } from "./protocol";
import { AUTO_STOP_MARGIN_MS, browserRunProblem, dropUnsent, keepUnsent, takeUnsent, useBrowserRunStatus } from "./browserRunStatus";
import { autoStopDelay, deliver, type DeliveryDeps } from "./browserRunDelivery";

// States after the worker finished or failed. The run's result or its loss is settled in this tab.
const alreadyRan = (state: ReturnType<typeof useBrowserRunStatus.getState>["runs"][string] | undefined) =>
  state?.kind === "sending" || state?.kind === "unsent" || state?.kind === "accepted" || state?.kind === "closed" || state?.kind === "crashed";

/* Model 2 runs execute in the browser. While one runs, the live view receives the worker's seconds through the
same store the server's snapshots used, and the run controls go to the worker. When it ends, the browser submits
what it did and the server replays it; only that replay becomes the record. */

export interface BrowserRunDeps { http: Pick<typeof http, "get" | "post">; apiUrl: string; startRun: typeof startModel2Run }

// The dependencies are parameters so tests can drive the whole lifecycle with a fake worker and a fake network.
export function createBrowserRuns(deps: BrowserRunDeps) {
  type Controls = ReturnType<typeof startModel2Run>;
  const active = new Map<string, { controls: Controls; speed: number; interventions: {options: InterventionOption[]; remainingSeconds: number} | null; autoStop?: ReturnType<typeof setTimeout> }>();

  const browserRunFor = (deploymentId: string) => active.get(deploymentId);

  // Concurrent callers (live notification, resync, status polling) share one start, so one worker runs.
  const starting = new Map<string, Promise<void>>();
  function startBrowserRun(deploymentId: string, onEnd?: (error?: string) => void) {
    if (active.has(deploymentId)) return Promise.resolve();
    // The server keeps a run in "browser" until it accepts the submission, so a remounted page or a stale status read
    // looks like a run waiting to start. This tab already ran it: never start a second worker or overwrite its state.
    if (alreadyRan(useBrowserRunStatus.getState().runs[deploymentId])) return Promise.resolve();
    let pending = starting.get(deploymentId);
    if (!pending) {
      useBrowserRunStatus.getState().set(deploymentId, { kind: "starting" });
      pending = launch(deploymentId, onEnd).catch((error: unknown) => {
        // The page tries again on its next check; meanwhile the learner is told why nothing is moving.
        useBrowserRunStatus.getState().set(deploymentId, { kind: "starting", problem: errorMessage(error, "The simulation could not be started in this browser.") });
        throw error;
      }).finally(() => starting.delete(deploymentId));
      starting.set(deploymentId, pending);
    }
    return pending;
  }
  async function launch(deploymentId: string, onEnd?: (error?: string) => void) {
    const { lifetimeRemainingSeconds, ...start }: Omit<RunStart, "speed"> & { lifetimeRemainingSeconds?: number } = (await deps.http.get(`${deps.apiUrl}/deployments/${deploymentId}/browser-run`)).data.browserRun;
    const status = useBrowserRunStatus.getState();
    status.set(deploymentId, { kind: "running" });
    let costUsd = 0;
    const entry: NonNullable<ReturnType<typeof browserRunFor>> = { speed: 1, controls: null as unknown as Controls, interventions: null };
    const finish = () => { clearTimeout(entry.autoStop); active.delete(deploymentId); };
    entry.controls = deps.startRun({ ...start, speed: 1 }, {
      onSecond: ({ view, logs, burnRatePerHourUsd, applicationFlow, interventions }) => {
        entry.interventions = interventions;
        costUsd += burnRatePerHourUsd / 3600;
        const snapshot: SimulationSnapshot = { ...(applicationFlow ? { applicationFlow } : {}), deploymentId, timestamp: new Date().toISOString(), simulatedSeconds: view.simulatedSeconds,
          loadFraction: view.loadFraction, metrics: view.metrics, logs, health: view.overallHealth, pools: view.pools, spawnedVms: [], restarting: [],
          activeChaos: view.activeChaos, speed: entry.speed, burnRatePerHourUsd, accumulatedCostUsd: costUsd, traffic: view.traffic };
        useSimulationStore.getState().applySnapshot(snapshot);
      },
      onDone: (submission) => { finish(); void send(deploymentId, submission).then(() => onEnd?.(), (error: Error) => onEnd?.(error.message)); },
      onError: (message) => {
        finish();
        useBrowserRunStatus.getState().set(deploymentId, { kind: "crashed", reason: message });
        // Close the run on the server so it does not hold one of the learner's run slots until it expires.
        void deps.http.post(`${deps.apiUrl}/deployments/${deploymentId}/cancel`, { reason: "browser-error" }).catch(() => {});
        onEnd?.(message);
      },
    });
    active.set(deploymentId, entry);
    // The server closes an unsent run a fixed real time after it was created, whatever speed or pause the simulation has.
    // Stopping a little before that sends the learner's result while the server still accepts it.
    if (typeof lifetimeRemainingSeconds === "number") {
      status.setDeadline(deploymentId, performance.now() + lifetimeRemainingSeconds * 1000);
      entry.autoStop = setTimeout(() => {
        if (active.get(deploymentId) !== entry) return;
        toast.info("This run reached the end of its real-time limit, so it was stopped and sent automatically to keep your result.");
        entry.controls.stop();
      }, autoStopDelay(lifetimeRemainingSeconds * 1000, AUTO_STOP_MARGIN_MS));
    }
  }

  const deliveryFor = (deploymentId: string, submission: RunSubmission): DeliveryDeps => ({
    send: async () => {
      // A run stopped before its first second has nothing to replay; it is cancelled instead.
      if (submission.stopAtSecond === 0) await deps.http.post(`${deps.apiUrl}/deployments/${deploymentId}/cancel`, {});
      else await deps.http.post(`${deps.apiUrl}/deployments/${deploymentId}/submit`, submission);
    },
    currentStatus: async () => (await deps.http.get(`${deps.apiUrl}/deployments/${deploymentId}`)).data.deployment.status,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    report: (state) => useBrowserRunStatus.getState().set(deploymentId, state),
  });

  // A submission survives a brief network or release outage and a busy replay queue (429): it is retried before giving up.
  // If it still cannot be sent it stays in this tab, labelled as not saved, and the learner can send it again.
  async function send(deploymentId: string, submission: RunSubmission) {
    keepUnsent(deploymentId, submission);
    const result = await deliver(deliveryFor(deploymentId, submission), { cancel: submission.stopAtSecond === 0 });
    if (result !== "unsent") dropUnsent(deploymentId);
    else throw new Error("The finished run could not be sent to the server.");
  }

  /** Sends a run that could not be delivered, from the copy this tab still holds. */
  async function sendAgain(deploymentId: string) {
    const submission = takeUnsent(deploymentId);
    if (!submission) return;
    await send(deploymentId, submission).catch(() => {});
  }

  // Run controls for an active browser run. A refusal is thrown with Model 2's plain reason.
  async function actInBrowser(deploymentId: string, request: ActionRequest): Promise<string> {
    const run = active.get(deploymentId);
    if (!run) throw new Error(browserRunProblem(deploymentId) ?? "This run is no longer running in this browser.");
    if (request.kind === "speed") {
      run.speed = request.parameters.speed; run.controls.setSpeed(request.parameters.speed);
      useSimulationStore.getState().setSpeed(request.parameters.speed);
      return "Speed changed";
    }
    const result: ActionResult = await run.controls.act(request);
    if (!result.ok) throw new Error(result.message);
    return "Action applied";
  }

  // Stopping a browser run ends the worker and submits it. The returned stop follows the run's server status.
  function stopBrowserRun(deploymentId: string): RunAction {
    active.get(deploymentId)?.controls.stop();
    return stopAction(deploymentId, "requested");
  }
  async function browserStopStatus(deploymentId: string): Promise<RunAction> {
    // A finished run that never reached the server is not "stopping": say so instead of waiting for a replay that will not come.
    const state = useBrowserRunStatus.getState().runs[deploymentId];
    if (state?.kind === "unsent" || state?.kind === "closed" || state?.kind === "crashed") return stopAction(deploymentId, "failed", state.reason);
    const status: string = (await deps.http.get(`${deps.apiUrl}/deployments/${deploymentId}`)).data.deployment.status;
    return stopAction(deploymentId, status === "torn-down" ? "completed" : status === "failed" ? "failed" : "running");
  }
  function stopAction(deploymentId: string, status: RunAction["status"], failure?: string): RunAction {
    return { id: `browser:${deploymentId}`, deploymentId, sequence: 0, kind: "teardown", parameters: {}, status, requestedAt: new Date().toISOString(),
      appliedAt: null, completedAt: null, appliedSimulatedSeconds: null, completedSimulatedSeconds: null, outcome: null,
      failureReason: status === "failed" ? failure ?? "The server could not replay this browser run." : null };
  }
  return { browserRunFor, startBrowserRun, sendAgain, actInBrowser, stopBrowserRun, browserStopStatus };
}

const runs = createBrowserRuns({ http, apiUrl: API_URL, startRun: startModel2Run });
export const { browserRunFor, startBrowserRun, sendAgain, actInBrowser, stopBrowserRun, browserStopStatus } = runs;
export const isBrowserStop = (actionId: string) => actionId.startsWith("browser:");
