import { expect, test } from "bun:test";
import { parseTraceChunks } from "../reality/trace-input";

const header = JSON.stringify({ schema: "infraforge-arrivals/1", unit: "us", durationUs: 10, provenance: "synthetic ingestion test" });
const row = JSON.stringify({ id: "r", atUs: 0, operation: "light", payloadBytes: 64 });
const budgets = { maxRows: 2, maxLineBytes: 256, maxBytes: 1024 };
async function* chunks(text: string) { const data = Buffer.from(text); for (let i = 0; i < data.length; i += 3) yield data.subarray(i, i + 3); }
test("bounded streaming NDJSON accepts arbitrary byte boundaries and validates authored rows", async () => {
  const parsed = await parseTraceChunks(chunks(`${header}\n${row}\n`), budgets, new Set(["light"])); expect(parsed.rows.length).toBe(1);
  await expect(parseTraceChunks(chunks(`${header}\n${row}\n${row}`), budgets, new Set(["light"]))).rejects.toThrow("identity");
  await expect(parseTraceChunks(chunks(`${header}\n${row}\n${row}\n${row}`), budgets, new Set(["light"]))).rejects.toThrow("budget");
  await expect(parseTraceChunks(chunks(`${header}\n${"x".repeat(300)}`), budgets, new Set(["light"]))).rejects.toThrow("line");
  await expect(parseTraceChunks(chunks(`${header}\n${row}`), { ...budgets, maxBytes: 10 }, new Set(["light"]))).rejects.toThrow("byte");
  await expect(parseTraceChunks(chunks(`${header}\n{`), budgets, new Set(["light"]))).rejects.toThrow();
  await expect(parseTraceChunks(chunks(`null\n${row}`), budgets, new Set(["light"]))).rejects.toThrow("schema");
});
