import { appendFileSync, writeFileSync } from "node:fs";
import { environment, telemetry } from "./telemetry";

const c = JSON.parse(process.argv[2]!);
const emit = (r: unknown) => appendFileSync(`/out/${c.id}.jsonl`, JSON.stringify(r) + "\n");
writeFileSync(`/out/${c.id}-environment.json`, JSON.stringify({ ...environment(), config: c }, null, 2) + "\n");
const start = performance.now() * 1000, stop = start + (c.warmupS + c.observeS) * 1e6;
const pending = new Map<string, Record<string, unknown>>();
let ordinal = 0, ended = false;
const timer = setInterval(() => emit({ kind: "sample", ...telemetry(), inflight: pending.size }), 1000);
while (performance.now() * 1000 < stop) {
  const now = performance.now() * 1000;
  while (start + ordinal * 1e6 / c.rate <= Math.min(now, stop - 1)) {
    const intendedUs = start + ordinal * 1e6 / c.rate, id = `${c.id}/${ordinal}`, key = 1 + ordinal % 1024;
    ordinal++;
    const row = { kind: "root", id, attempt: 1, operation: c.operation, key, intendedUs,
      phase: intendedUs < start + c.warmupS * 1e6 ? "warmup" : "observed", deadlineUs: intendedUs + c.deadlineMs * 1000 };
    if (now - intendedUs > c.maxLagMs * 1000 || pending.size >= c.maxInflight) {
      emit({ ...row, actualSendUs: null, responseUs: null, outcome: "generator-drop", reason: now - intendedUs > c.maxLagMs * 1000 ? "lag" : "inflight-cap" }); continue;
    }
    const sent = { ...row, actualSendUs: performance.now() * 1000 };
    pending.set(id, sent);
    const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), Math.max(1, (row.deadlineUs - performance.now() * 1000) / 1000));
    void fetch(`http://app:8080/${c.operation}`, { headers: { "x-root-id": id, "x-key": String(key) }, signal: controller.signal })
      .then(async (response) => { const bytes = (await response.arrayBuffer()).byteLength;
        if (!ended) emit({ ...sent, responseUs: performance.now() * 1000, status: response.status, responseBodyBytes: bytes, outcome: response.ok ? "completed" : "http-error" }); })
      .catch((error) => { if (!ended) emit({ ...sent, responseUs: performance.now() * 1000, outcome: controller.signal.aborted ? "deadline" : "transport-error", error: String(error) }); })
      .finally(() => { clearTimeout(deadline); pending.delete(id); });
  }
  await Bun.sleep(2);
}
// Account for the final scheduled rows even if the scheduler crossed the window end.
while (ordinal < Math.ceil((c.warmupS + c.observeS) * c.rate)) {
  const intendedUs = start + ordinal * 1e6 / c.rate;
  emit({ kind: "root", id: `${c.id}/${ordinal}`, attempt: 1, operation: c.operation, key: 1 + ordinal % 1024,
    intendedUs, phase: intendedUs < start + c.warmupS * 1e6 ? "warmup" : "observed", deadlineUs: intendedUs + c.deadlineMs * 1000,
    actualSendUs: null, responseUs: null, outcome: "generator-drop", reason: "window-ended" }); ordinal++;
}
const drainStop = performance.now() + c.deadlineMs + 500;
while (pending.size && performance.now() < drainStop) await Bun.sleep(10);
ended = true; clearInterval(timer);
for (const row of pending.values()) emit({ ...row, responseUs: null, outcome: "right-censored", censoredUs: performance.now() * 1000 });
emit({ kind: "end", startUs: start, stopUs: stop, actualEndUs: performance.now() * 1000, offered: ordinal, pending: pending.size, ...telemetry() });
process.exit(0);
