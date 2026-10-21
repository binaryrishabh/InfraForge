import { canonical, wallBudget } from "./protocol";
import type { BrowserRequest, BrowserResult, WorkerReply } from "./protocol";

interface WorkerPort {
  onmessage: ((event: MessageEvent<WorkerReply>) => void) | null; onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null; postMessage(value: string): void; terminate(): void;
}
let active = false;
export function runFirstStackInBrowser(request: BrowserRequest, options: { signal?: AbortSignal; worker?: () => WorkerPort } = {}) {
  if (active) throw Error("A browser simulation is already running");
  const text = canonical(request), wall = wallBudget(request.wallMs);
  let port: WorkerPort | undefined, timer: ReturnType<typeof setTimeout> | undefined, settled = false;
  let finish: (result: BrowserResult) => void;
  const result = new Promise<BrowserResult>(resolve => { finish = resolve; });
  const end = (value: BrowserResult) => {
    if (settled) return;
    settled = true; clearTimeout(timer); options.signal?.removeEventListener("abort", cancel);
    port?.terminate(); active = false; finish(value);
  };
  const interrupted = (reason: string): BrowserResult => ({ status: "interrupted", reason, evidence: null,
    memory: { observedHeapBytes: "Unknown", enforcement: "logical-limits-only" } });
  const cancel = () => end(interrupted("Browser run cancelled"));
  active = true;
  if (options.signal?.aborted) cancel();
  else {
    try {
      // A literal module URL lets Vite emit a separate worker bundle when used.
      port = options.worker?.() ?? new Worker(new URL("./worker/entry.ts", import.meta.url), { type: "module", name: "first-stack" });
      port.onmessage = event => {
        const reply = event.data;
        if (reply?.kind === "result") end(reply.value);
        else end(interrupted(reply?.kind === "error" ? reply.message : "Invalid worker response"));
      };
      port.onerror = () => end(interrupted("Browser worker failed"));
      port.onmessageerror = () => end(interrupted("Browser worker message failed"));
      options.signal?.addEventListener("abort", cancel, { once: true });
      timer = setTimeout(() => end(interrupted("Browser wall-time watchdog terminated the worker")), wall);
      port.postMessage(text);
    } catch (error) { end(interrupted(error instanceof Error ? error.message : "Browser worker unavailable")); }
  }
  return { result, cancel };
}
