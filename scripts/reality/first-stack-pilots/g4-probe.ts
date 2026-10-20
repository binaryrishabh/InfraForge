import { appendFileSync } from "node:fs";
import { environment, telemetry } from "./telemetry";

const sql = new Bun.SQL(`postgres://postgres@${process.argv[2]!}/pilot`, { max: 1, idleTimeout: 0, connectionTimeout: 3 });
const emit = (r: object) => appendFileSync("/out/g4-samples.jsonl", JSON.stringify({ atUs: performance.now() * 1000, ...r }) + "\n");
let running = true, count = 0;
process.on("SIGTERM", () => { running = false; });
emit({ kind: "environment", environment: environment() });
try {
  while (running) {
    const start = performance.now();
    const waits = await sql.unsafe("SELECT application_name,state,wait_event_type,wait_event,count(*)::int AS count FROM pg_stat_activity WHERE application_name LIKE 'g4-%' GROUP BY application_name,state,wait_event_type,wait_event ORDER BY application_name,state,wait_event_type,wait_event");
    emit({ kind: "sample", waits, telemetry: count++ % 4 === 0 ? telemetry() : null });
    await Bun.sleep(Math.max(0, 250 - (performance.now() - start)));
  }
  emit({ kind: "end", samples: count });
} catch (error) { emit({ kind: "failure", reason: String(error) }); process.exitCode = 1; }
finally { await sql.close({ timeout: 0 }); }
