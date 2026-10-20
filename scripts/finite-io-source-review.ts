import { readFileSync } from "node:fs";
import { sourceHash } from "../apps/backend/executionIdentity/hash";

export const finiteIoAdded = ["packages/simulation/src/model2/composition/io-budget.ts", "packages/simulation/src/model2/data/io-contract.ts", "packages/simulation/src/model2/data/io.ts", "packages/simulation/src/firstStack/io.ts"];
export const finiteIoChanged = ["packages/simulation/src/model2/composition/run.ts", "packages/simulation/src/model2/data/database.ts", "packages/simulation/src/model2/data/modules.ts", "packages/simulation/src/model2/data/run.ts", "packages/simulation/src/firstStack/run.ts", "packages/simulation/src/internalFirstStack.ts"];
export const finiteIoReviewPath = "docs/reality/finite-io-source-review.json";
export interface FiniteIoReview {
  schema: string; baseline: string; source: string; scope: string;
  files: Array<{ path: string; hash: string; original: string | null; originalHash: string | null }>;
  acceptance: Array<{ path: string; hash: string }>;
}
export function beforeFiniteIo(path: string, text: string) {
  if (!finiteIoChanged.includes(path)) return text;
  const review = JSON.parse(readFileSync(finiteIoReviewPath, "utf8")) as FiniteIoReview;
  const pin = review.files.find(f => f.path === path);
  if (review.schema !== "finite-io-source-review/1" || !pin || pin.original === null || sourceHash(text) !== pin.hash || sourceHash(pin.original) !== pin.originalHash) throw Error(`Unreviewed finite IO source: ${path}`);
  return pin.original;
}
