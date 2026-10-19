import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { RunRecordSchema } from "../../apps/backend/runRecords/schema";

const file = resolve(import.meta.dir, "../../docs/reality/run-record.schema.json");
export function runRecordSchemaText() {
  return JSON.stringify(z.toJSONSchema(RunRecordSchema, { unrepresentable: "any" }), null, 2) + "\n";
}
if (import.meta.main) {
  const text = runRecordSchemaText();
  if (process.argv.includes("--write")) writeFileSync(file, text);
  else if (readFileSync(file, "utf8").replaceAll("\r\n", "\n") !== text) throw Error("RunRecord schema drift");
  console.info("RunRecord schema: infraforge-run-record/1");
}
