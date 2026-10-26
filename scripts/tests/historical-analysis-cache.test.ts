import { expect, test } from "bun:test";
import { withHistoricalAnalysisCache, memoHistoricalImports } from "../historical-analysis-cache";
import { historicalIsolationLoading } from "../historical-isolation-loading";
import { historicalHostLoading } from "../historical-host-loading";
import { sourceHash, digest } from "../../apps/backend/executionIdentity/hash";
import { loadTransitions } from "../../apps/backend/executionIdentity/transitions";
import { frozenBaselineAlgorithms } from "../frozen-baseline";
import { resolve } from "node:path";

test("historical memo keys bind algorithm, path, exact source and complete review; values cannot poison later hits", () => {
  let calls = 0;
  const run = (algorithm = "one", path = "fixture.ts", text = "source", review: unknown = { hash: "review" }) =>
    memoHistoricalImports(algorithm, path, text, review, () => { calls++; return [{ path: "./verified", kind: "import-statement" }]; });
  withHistoricalAnalysisCache(() => {
    run()[0]!.path = "./poison";
    expect(run()[0]!.path).toBe("./verified"); expect(calls).toBe(1);
    run("two"); run("one", "other.ts"); run("one", "fixture.ts", "changed"); run("one", "fixture.ts", "source", { hash: "changed" });
    expect(calls).toBe(5);
  });
  withHistoricalAnalysisCache(() => run()); expect(calls).toBe(6);
  expect(() => withHistoricalAnalysisCache(() => { run(); throw Error("failure"); })).toThrow("failure");
  withHistoricalAnalysisCache(() => run()); expect(calls).toBe(8);
});

test("warm historical analysis still rejects altered source, missing exact reviews and revoked globals", () => {
  const path = "apps/backend/fixture.ts", text = 'export const value = (o: Record<string, string>, k: string) => o[k];';
  const review = { hash: sourceHash(text), capabilities: ["computed-data"] };
  withHistoricalAnalysisCache(() => {
    for (const loader of [
      (reviews: Record<string, typeof review>) => historicalIsolationLoading(reviews),
      (reviews: Record<string, typeof review>) => historicalHostLoading(reviews, { modules: [] }),
    ]) {
      expect(() => loader({ [path]: review }).executionImports(text, path)).not.toThrow();
      expect(() => loader({ [path]: review }).executionImports(text + "\n// changed", path)).toThrow("Unreviewed");
      expect(() => loader({}).executionImports(text, path)).toThrow("Unreviewed");
      expect(() => loader({ [path]: { ...review, capabilities: [] } }).executionImports(text, path)).toThrow("Unreviewed");
    }
    const globalText = 'export const value = new Headers();', hash = sourceHash(globalText);
    historicalIsolationLoading({ [path]: { hash, capabilities: [], globals: { hash, names: ["Headers"] } } }).executionImports(globalText, path);
    expect(() => historicalIsolationLoading({ [path]: { hash, capabilities: [] } }).executionImports(globalText, path)).toThrow("Unreviewed");
  });
});

test("warm reconstruction binds every historical blob, descriptor and snapshot inventory", () => {
  const store = loadTransitions(resolve(import.meta.dir, "../..")), history = store.history();
  const row = store.table.entries.at(-1)!, files = history.trees[row.commit]!;
  const tree = { paths: Object.keys(files), read: (path: string) => history.blobs[files[path]!]! };
  const runtime = store.table.descriptors[row.descriptor]!.runtime;
  // Reconstruct with the frozen algorithm the newest row records, not a fixed older version.
  const historicalDeclaredHostDescriptor = frozenBaselineAlgorithms.find(item => item.id === row.algorithm)!.reconstruct;
  withHistoricalAnalysisCache(() => {
    expect(digest(historicalDeclaredHostDescriptor(tree, runtime))).toBe(row.descriptor);
    const path = "packages/contracts/src/internal-model2/index.ts";
    const edited = { ...tree, read: (file: string) => tree.read(file) + (file === path ? "\n// tampered blob" : "") };
    expect(digest(historicalDeclaredHostDescriptor(edited, runtime))).not.toBe(row.descriptor);
    const missing = { ...tree, paths: tree.paths.filter(file => file !== path) };
    expect(() => historicalDeclaredHostDescriptor(missing, runtime)).toThrow();
    const changed = structuredClone(store.table.descriptors[row.descriptor]!); changed.runtime = "bun-unknown";
    expect(digest(historicalDeclaredHostDescriptor(tree, runtime))).not.toBe(digest(changed));
  });
}, 30000);
