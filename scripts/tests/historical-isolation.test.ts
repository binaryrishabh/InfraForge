import { expect, test } from "bun:test";
import { loadTransitions } from "../../apps/backend/executionIdentity/transitions";
import { repositoryRoot } from "../../apps/backend/executionIdentity/descriptor";
import { digest } from "../../apps/backend/executionIdentity/hash";
import { historicalIsolationDescriptor } from "../historical-isolation-descriptor";
import { historicalAnalysisDescriptor } from "../historical-analysis-descriptor";

test("the isolated main snapshot reconstructs exactly and every isolated host remains pinned without Git", () => {
  const store = loadTransitions(repositoryRoot), history = store.history();
  const row = store.table.entries.find(row => row.commit === "f945fa521f0c8f548edb2feb2c3928d8eacd2253")!;
  expect(row.algorithm).toBe("isolation-boundary/1");
  const files = history.trees[row.commit]!, paths = Object.keys(files);
  const tree = { paths, read: (path: string) => { const text = history.blobs[files[path]!]; if (text === undefined) throw Error("Missing snapshot source"); return text; } };
  const runtime = store.table.descriptors[row.descriptor]!.runtime;
  expect(digest(historicalIsolationDescriptor(tree, runtime))).toBe(row.source);
  expect(digest(historicalAnalysisDescriptor(tree, runtime))).not.toBe(row.source);
  for (const name of ["isolationChild", "isolatedExecution", "isolationConnection", "isolationOwnership"]) {
    const path = `apps/backend/firstStack/${name}.ts`;
    expect(() => historicalIsolationDescriptor({ paths: paths.filter(p => p !== path), read: p => { if (p === path) throw Error("Missing isolated host"); return tree.read(p); } }, runtime)).toThrow();
    expect(() => {
      const changed = historicalIsolationDescriptor({ paths, read: p => tree.read(p) + (p === path ? "\n" : "") }, runtime);
      if (digest(changed) !== row.source) throw Error("Isolated host source digest changed");
    }).toThrow();
  }
}, 60000);
