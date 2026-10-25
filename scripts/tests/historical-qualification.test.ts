import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { repositoryRoot } from "../../apps/backend/executionIdentity/descriptor";
import { digest, lf, sourceHash } from "../../apps/backend/executionIdentity/hash";
import { loadTransitions, validateTransitions } from "../../apps/backend/executionIdentity/transitions";
import { frozenBaselineAlgorithms } from "../frozen-baseline";
import { withHistoricalAnalysisCache } from "../historical-analysis-cache";
import { historicalIsolationLoading } from "../historical-isolation-loading";
import { historicalQualificationLoading } from "../historical-qualification-loading";

const adapter = "apps/backend/firstStack/isolationConnection.ts";
const read = (path: string) => lf(readFileSync(resolve(repositoryRoot, path), "utf8"));
const source = read(adapter);
const reviews = JSON.parse(read("apps/backend/executionIdentity/capabilityReviews.json"));

test("transition validation recognizes the new frozen version and still rejects unknown versions", () => {
  const { table } = loadTransitions(repositoryRoot);
  const copy = structuredClone(table);
  copy.entries.at(-1)!.algorithm = "qualification-boundary/1";
  expect(() => validateTransitions(copy, digest(copy))).not.toThrow();
  copy.entries.at(-1)!.algorithm = "qualification-boundary/2" as "qualification-boundary/1";
  expect(() => validateTransitions(copy, digest(copy))).toThrow("Unknown execution transition algorithm");
});

test("qualification frozen loader accepts only the exact reviewed process adapter at its reviewed path", () => {
  const loader = historicalQualificationLoading(reviews);
  expect(loader.executionImports(source, adapter)).toContainEqual({ path: "node:child_process", kind: "import-statement" });
  expect(loader.executionImports(source.replaceAll("\n", "\r\n"), adapter)).toEqual(loader.executionImports(source, adapter));
  for (const text of [source + "\n// changed adapter\n", source.replace('"/usr/bin/systemctl"', '"/tmp/systemctl"')]) {
    // Refreshing the ordinary exact-source review must not grant process access.
    const hash = sourceHash(text), review = { ...reviews[adapter], hash, globals: { ...reviews[adapter].globals, hash } };
    expect(() => historicalQualificationLoading({ ...reviews, [adapter]: review }).executionImports(text, adapter))
      .toThrow("Unreviewed dynamic execution loader");
  }
  const relocated = "apps/backend/firstStack/unreviewedConnection.ts";
  expect(() => historicalQualificationLoading({ [relocated]: reviews[adapter] }).executionImports(source, relocated))
    .toThrow("Unreviewed dynamic execution loader");
});

test("qualification cache entries cannot grant the new adapter to an older frozen loader", () => {
  withHistoricalAnalysisCache(() => {
    historicalQualificationLoading(reviews).executionImports(source, adapter);
    expect(() => historicalIsolationLoading(reviews).executionImports(source, adapter)).toThrow("Unreviewed dynamic execution loader");
  });
});

test("the old adapter stays rejected by the new frozen loader even after the old loader warms the cache", () => {
  const store = loadTransitions(repositoryRoot), history = store.history();
  const row = store.table.entries.find(entry => entry.algorithm === "isolation-boundary/1")!;
  const files = history.trees[row.commit]!;
  const old = history.blobs[files[adapter]!]!;
  const oldReviews = JSON.parse(history.blobs[files["apps/backend/executionIdentity/capabilityReviews.json"]!]!);
  withHistoricalAnalysisCache(() => {
    historicalIsolationLoading(oldReviews).executionImports(old, adapter);
    expect(() => historicalQualificationLoading(oldReviews).executionImports(old, adapter)).toThrow("Unreviewed dynamic execution loader");
  });
});

test("all three existing frozen algorithms still reconstruct their retained historical baselines", () => {
  const store = loadTransitions(repositoryRoot), history = store.history();
  withHistoricalAnalysisCache(() => {
    for (const id of ["analysis-boundary/1", "isolation-boundary/1", "declared-host-boundary/1"]) {
      const algorithm = frozenBaselineAlgorithms.find(entry => entry.id === id)!;
      const rows = store.table.entries.filter(entry => entry.algorithm === id);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const files = history.trees[row.commit]!;
        const tree = { paths: Object.keys(files), read: (path: string) => {
          const text = history.blobs[files[path]!];
          if (text === undefined) throw Error(`Missing historical source: ${path}`);
          return text;
        } };
        expect(digest(algorithm.reconstruct(tree, store.table.descriptors[row.descriptor]!.runtime))).toBe(row.source);
      }
    }
  });
}, 120000);
