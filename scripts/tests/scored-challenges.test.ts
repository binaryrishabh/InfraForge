import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { sourceHash } from "../../apps/backend/executionIdentity/hash";

test("scored challenge review binds server-only JSON, execution, projection and acceptance", () => {
  const review = JSON.parse(readFileSync("docs/reality/scored-challenges-source-review.json", "utf8"));
  expect(review.schema).toBe("scored-challenges-source-review/1");
  expect(review.files).toHaveLength(10); expect(review.acceptance).toHaveLength(4);
  for (const row of [...review.files, ...review.acceptance]) expect(sourceHash(readFileSync(row.path, "utf8"))).toBe(row.hash);
});
