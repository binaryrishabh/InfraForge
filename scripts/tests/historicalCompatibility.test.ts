import { historicalSlice } from "../historical-slice-reviews";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ignore from "ignore";
import { sourceHash } from "../../apps/backend/executionIdentity/hash";

test("historical compatibility receipt covers readers, containment, migration and acceptance", () => {
  const { review, read: historicalSource } = historicalSlice("docs/reality/historical-compatibility-source-review.json");
  expect(review.schema).toBe("historical-compatibility-source-review/1");
  for (const row of [...review.files, ...(review.acceptance ?? [])]) expect(sourceHash(historicalSource(row.path))).toBe(row.hash!);
  expect(review.files.some((r: { path: string }) => r.path.endsWith("historicalReplay.ts"))).toBe(true);
  expect(review.files.some((r: { path: string }) => r.path.endsWith("historical_replay/migration.sql"))).toBe(true);
});
test("historical replay ships a strictly additive reservation schema and stays inactive", () => {
  const sql = readFileSync("apps/backend/prisma/migrations/20261022000000_historical_replay/migration.sql", "utf8");
  expect(sql.match(/CREATE TABLE/g)).toHaveLength(1);
  expect(sql).not.toMatch(/\b(?:ALTER|DROP|TRUNCATE)\b/);
  expect(sql).toContain("CREATE TABLE \"FirstStackReplay\"");
  expect(sql).toContain("Historical replay requires matching pinned executor evidence and cleanup");
  const context = ignore().add(readFileSync(".dockerignore", "utf8"));
  for (const path of ["apps/backend/firstStack/historicalReplay.ts", "apps/backend/firstStack/migration.ts", "apps/backend/runRecords/historical.ts",
    "apps/backend/prisma/migrations/20261022000000_historical_replay/migration.sql"]) expect(context.ignores(path)).toBe(false);
  const queue = readFileSync("apps/backend/firstStack/submissionQueue.ts", "utf8");
  expect(queue).toContain("replayPolicy = { enabled: false }"); expect(queue).toContain("setGlobalConcurrency(1)");
  for (const host of ["index.ts", "worker.ts"]) {
    const text = readFileSync(`apps/backend/${host}`, "utf8");
    expect(text).not.toContain("startSubmissionQueue"); expect(text).not.toContain("createSubmissionRouter");
  }
});
