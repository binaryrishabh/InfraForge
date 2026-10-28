import { ActionRefused, createModel2Run, type Model2Run } from "@infraforge/simulation/model2-run";
import type { FromWorker, RunStart, RunSubmission, ToWorker } from "../protocol";

type Timers = { set: (run: () => void, ms: number) => unknown; clear: (handle: unknown) => void };
const realTimers: Timers = { set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };

/* Runs one Model 2 run inside the worker: one simulated second per 1000/speed ms (or as fast as the engine
allows), the live view after every second, and actions applied locally. Speed 0 pauses. */
export function createRunHost(post: (message: FromWorker) => void, timers: Timers = realTimers) {
  let run: Model2Run | null = null, start: RunStart | null = null, speed = 1, timer: unknown = null, finished = false;
  const submitted: RunSubmission["actions"] = [];

  const finish = () => {
    if (finished || !run) return;
    finished = true;
    if (timer !== null) timers.clear(timer);
    post({ type: "done", submission: { stopAtSecond: run.simulatedSeconds, actions: submitted } });
  };

  const step = () => {
    timer = null;
    if (finished || !run || !start || speed === 0) return;
    const began = Date.now();
    try {
      const logs = run.advance();
      const second = run.simulatedSeconds, plan = start.experiment;
      // The server applies a scheduled fault right after the tick that reaches its second; so does the browser.
      if (plan && second === plan.atSimulatedSecond) {
        run.apply({ kind: "chaos", parameters: { type: plan.fault, resourceId: plan.resourceId, trigger: "challenge-experiment" } });
      }
      post({ type: "second", view: run.view(), logs, burnRatePerHourUsd: run.burnRatePerHourUsd() });
      if (second >= start.stopAtSecond) { finish(); return; }
    } catch (error) {
      finished = true;
      post({ type: "error", message: error instanceof Error ? error.message : "The run stopped unexpectedly." });
      return;
    }
    timer = timers.set(step, Math.max(0, 1000 / speed - (Date.now() - began)));
  };

  const act = (id: string, request: Extract<ToWorker, { type: "action" }>["request"]) => {
    if (!run || finished) return post({ type: "action", id, ok: false, message: "The run is not running." });
    try {
      const at = run.simulatedSeconds, applied = run.apply(request);
      submitted.push({ atSecond: at, request });
      post({ type: "action", id, ok: true, outcome: applied.outcome });
    } catch (error) {
      post({ type: "action", id, ok: false, message: error instanceof ActionRefused ? error.message : "The action could not be applied." });
    }
  };

  return {
    handle(message: ToWorker) {
      if (message.type === "start") {
        if (run) return post({ type: "error", message: "This worker already runs a simulation." });
        try { run = createModel2Run(message.start.input, message.start.horizonSeconds); }
        catch (error) { return post({ type: "error", message: error instanceof Error ? error.message : "Model 2 cannot run this design." }); }
        start = message.start; speed = message.start.speed;
        timer = timers.set(step, 0);
      } else if (message.type === "speed") {
        speed = message.speed;
        if (speed > 0 && timer === null && !finished) timer = timers.set(step, 0);
      } else if (message.type === "action") act(message.id, message.request);
      else finish();
    },
  };
}
