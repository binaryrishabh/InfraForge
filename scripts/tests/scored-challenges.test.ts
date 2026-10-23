import { historicalSlice } from "../historical-slice-reviews";
import { expect, test } from "bun:test";
import { sourceHash } from "../../apps/backend/executionIdentity/hash";

test("scored challenge review binds server-only JSON, execution, projection and acceptance", () => {
  const { review, read: historicalSource } = historicalSlice("docs/reality/scored-challenges-source-review.json");
  expect(review.schema).toBe("scored-challenges-source-review/1");
  expect(review.files).toHaveLength(16); expect(review.acceptance).toHaveLength(5);
  for (const id of ["url-redirect", "catalogue-api", "reviews-api", "small-paste-api", "preloaded-news-api", "price-history-api"]) {
    expect(review.files.some((row: { path: string }) => row.path === `apps/backend/firstStack/scoredChallenges/${id}.v1.json`)).toBe(true);
  }
  for (const row of [...review.files, ...(review.acceptance ?? [])]) expect(sourceHash(historicalSource(row.path))).toBe(row.hash!);
});
