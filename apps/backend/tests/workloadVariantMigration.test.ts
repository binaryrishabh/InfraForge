import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { ADDITIVE_MIGRATIONS } from "../release/migrations";

test("variant migration preserves the existing trigger body outside its added branch and workload exception", async () => {
  const directory = new URL("../prisma/migrations/", import.meta.url);
  const old = await readFile(new URL("20261013010000_honest_reruns/migration.sql", directory), "utf8");
  const sql = await readFile(new URL("20261103000000_workload_variant_reruns/migration.sql", directory), "utf8");
  const body = (text: string) => text.replaceAll("\r\n", "\n").match(/CREATE OR REPLACE FUNCTION capture_run_identity\(\)[\s\S]*?END \$\$;/)![0];
  const stripped = body(sql).replace(/    ELSIF NEW\."rerunMode" = 'workload-variant' THEN[\s\S]*?(?=    ELSIF NEW\."rerunMode" = 'current-design')/, "")
    .replace('(NEW."rerunMode" <> \'workload-variant\' AND NEW."runInputs"->\'workloadProfile\' IS DISTINCT FROM source."runInputs"->\'workloadProfile\')', 'NEW."runInputs"->\'workloadProfile\' IS DISTINCT FROM source."runInputs"->\'workloadProfile\'');
  expect(stripped).toBe(body(old));
  expect(sql.trim().startsWith("BEGIN;")).toBe(true);
  expect(sql.trim().endsWith("COMMIT;")).toBe(true);
  expect(sql).toContain("pg_constraint");
  expect(sql).toContain("pg_attribute");
  expect(sql).toContain('source."challengeId" IS NOT NULL');
  expect(sql).toContain('source."challengeVersion" IS NOT NULL');
  expect(sql).toContain('(NEW."runInputs" - \'workloadProfile\') IS DISTINCT FROM (source."runInputs" - \'workloadProfile\')');
  expect(sql).toContain('(NEW."runInputs"->\'workloadProfile\') - \'workloadDynamics\'');
  expect([...ADDITIVE_MIGRATIONS].at(-1)).toBe("20261103000000_workload_variant_reruns");
});
