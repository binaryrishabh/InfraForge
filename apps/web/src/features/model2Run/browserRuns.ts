import type { ActionRequest, RunAction } from "@infraforge/contracts/actions";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { http, API_URL } from "@/client/httpClient";
import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
import { startModel2Run, type ActionResult } from "./runner";
import type { RunStart, RunSubmission } from "./protocol";

/* Model 2 runs execute in the browser. While one runs, the live view receives the worker's seconds through the
same store the server's snapshots used, and the run controls go to the worker. When it ends, the browser submits
what it did and the server replays it; only that replay becomes the record. */

type Controls = ReturnType<typeof startModel2Run>;
const active = new Map<string, { controls: Controls; speed: number }>();

export const browserRunFor = (deploymentId: string) => active.get(deploymentId);

// Concurrent callers (live notification, resync, status polling) share one start, so one worker runs.
const starting = new Map<string, Promise<void>>();
export function startBrowserRun(deploymentId: string, onEnd?: (error?: string) => void) {
  if (active.has(deploymentId)) return Promise.resolve();
  let pending = starting.get(deploymentId);
  if (!pending) {
    pending = launch(deploymentId, onEnd).finally(() => starting.delete(deploymentId));
    starting.set(deploymentId, pending);
  }
  return pending;
}
async function launch(deploymentId: string, onEnd?: (error?: string) => void) {
  const start: Omit<RunStart, "speed"> = (await http.get(`${API_URL}/deployments/${deploymentId}/browser-run`)).data.browserRun;
  let costUsd = 0;
  const entry = { speed: 1, controls: null as unknown as Controls };
  entry.controls = startModel2Run({ ...start, speed: 1 }, {
    onSecond: ({ view, logs, burnRatePerHourUsd }) => {
      costUsd += burnRatePerHourUsd / 3600;
      const snapshot: SimulationSnapshot = { deploymentId, timestamp: new Date().toISOString(), simulatedSeconds: view.simulatedSeconds,
        loadFraction: view.loadFraction, metrics: view.metrics, logs, health: view.overallHealth, pools: view.pools, spawnedVms: [], restarting: [],
        activeChaos: view.activeChaos, speed: entry.speed, burnRatePerHourUsd, accumulatedCostUsd: costUsd, traffic: view.traffic };
      useSimulationStore.getState().applySnapshot(snapshot);
    },
    onDone: (submission) => { active.delete(deploymentId); void submit(deploymentId, submission).then(() => onEnd?.(), (error: Error) => onEnd?.(error.message)); },
    onError: (message) => { active.delete(deploymentId); onEnd?.(message); },
  });
  active.set(deploymentId, entry);
}

// A submission survives a brief network or release outage and a busy replay queue (429): it is retried before giving up.
// A run stopped before its first second has nothing to replay; it is cancelled instead, with the same retries.
async function submit(deploymentId: string, submission: RunSubmission) {
  const cancel = submission.stopAtSecond === 0;
  for (let attempt = 1; ; attempt++) {
    try {
      if (cancel) await http.post(`${API_URL}/deployments/${deploymentId}/cancel`, {});
      else await http.post(`${API_URL}/deployments/${deploymentId}/submit`, submission);
      return;
    }
    catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      // 409 on cancel: the run is no longer waiting (an earlier cancel succeeded but its reply was lost).
      if (cancel && status === 409) return;
      if ((status !== undefined && status < 500 && status !== 429) || attempt === 8) throw new Error("The finished run could not be submitted for the official replay.", { cause: error });
      await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
    }
  }
}

// Run controls for an active browser run. A refusal is thrown with Model 2's plain reason.
export async function actInBrowser(deploymentId: string, request: ActionRequest): Promise<string> {
  const run = active.get(deploymentId)!;
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
export function stopBrowserRun(deploymentId: string): RunAction {
  active.get(deploymentId)?.controls.stop();
  return stopAction(deploymentId, "requested");
}
export const isBrowserStop = (actionId: string) => actionId.startsWith("browser:");
export async function browserStopStatus(deploymentId: string): Promise<RunAction> {
  const status: string = (await http.get(`${API_URL}/deployments/${deploymentId}`)).data.deployment.status;
  return stopAction(deploymentId, status === "torn-down" ? "completed" : status === "failed" ? "failed" : "running");
}
function stopAction(deploymentId: string, status: RunAction["status"]): RunAction {
  return { id: `browser:${deploymentId}`, deploymentId, sequence: 0, kind: "teardown", parameters: {}, status, requestedAt: new Date().toISOString(),
    appliedAt: null, completedAt: null, appliedSimulatedSeconds: null, completedSimulatedSeconds: null, outcome: null,
    failureReason: status === "failed" ? "The server could not replay this browser run." : null };
}
