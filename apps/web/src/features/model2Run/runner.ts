import type { ActionOutcome, ActionRequest } from "@infraforge/contracts/actions";
import type { FromWorker, RunStart, RunSubmission, ToWorker } from "./protocol";

export type ActionResult = { ok: true; outcome: ActionOutcome } | { ok: false; message: string };
export interface RunCallbacks {
  onSecond: (second: Extract<FromWorker, { type: "second" }>) => void;
  onDone: (submission: RunSubmission) => void;
  onError: (message: string) => void;
}
type WorkerLike = Pick<Worker, "postMessage" | "terminate"> & { onmessage: Worker["onmessage"]; onerror: Worker["onerror"] };

// Page-side control of one browser run. The worker does the simulation; the page only sends and receives messages.
export function startModel2Run(start: RunStart, callbacks: RunCallbacks,
  createWorker: () => WorkerLike = () => new Worker(new URL("./worker/worker.ts", import.meta.url), { type: "module", name: "model2-run" })) {
  const worker = createWorker(), pending = new Map<string, (result: ActionResult) => void>();
  let next = 0, ended = false;
  const send = (message: ToWorker) => worker.postMessage(message);
  const end = () => {
    ended = true; worker.terminate();
    for (const resolve of pending.values()) resolve({ ok: false, message: "The run ended." });
    pending.clear();
  };
  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    const message = event.data;
    if (message.type === "second") callbacks.onSecond(message);
    else if (message.type === "action") {
      pending.get(message.id)?.(message.ok ? { ok: true, outcome: message.outcome } : { ok: false, message: message.message });
      pending.delete(message.id);
    } else if (message.type === "done") { end(); callbacks.onDone(message.submission); }
    else { end(); callbacks.onError(message.message); }
  };
  worker.onerror = () => { if (!ended) { end(); callbacks.onError("The simulation worker failed."); } };
  send({ type: "start", start });
  return {
    setSpeed: (speed: number) => { if (!ended) send({ type: "speed", speed }); },
    act: (request: ActionRequest) => new Promise<ActionResult>((resolve) => {
      if (ended) return resolve({ ok: false, message: "The run ended." });
      const id = String(++next);
      pending.set(id, resolve);
      send({ type: "action", id, request });
    }),
    stop: () => { if (!ended) send({ type: "stop" }); },
    cancel: () => { if (!ended) end(); },
  };
}
