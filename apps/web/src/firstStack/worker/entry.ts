import { executeBrowser } from "./execute";
import type { BrowserRequest, WorkerReply } from "../protocol";

// One bounded job per disposable worker; no network, storage or server imports.
let started = false;
const scope = globalThis as unknown as { onmessage: ((event: MessageEvent<string>) => void) | null; postMessage(value: WorkerReply): void; close(): void };
scope.onmessage = event => {
  if (started) return;
  started = true;
  void (async () => {
    try {
      if (typeof event.data !== "string" || event.data.length > 4 * 1024 * 1024) throw Error("Browser input byte budget exceeded");
      const request: BrowserRequest = JSON.parse(event.data);
      scope.postMessage({ kind: "result", value: await executeBrowser(request) });
    } catch (error) { scope.postMessage({ kind: "error", message: error instanceof Error ? error.message.slice(0, 1000) : "Browser execution failed" }); }
    finally { scope.close(); }
  })();
};
