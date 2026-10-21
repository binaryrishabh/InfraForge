import { expect, test } from "bun:test";
import { diskTree, executionDescriptor } from "../../apps/backend/executionIdentity/descriptor";
import { digest } from "../../apps/backend/executionIdentity/hash";
import type { SourceTree } from "../../apps/backend/executionIdentity/sourceTree";
import { declaredExecutionHosts } from "../historical-declared-host-descriptor";
import { frozenBaselineAlgorithms, selectFrozenBaseline } from "../frozen-baseline";

function futureBaseline() {
  const current = diskTree(), descriptor = executionDescriptor(current);
  // Mirror the refresh archive, without live resolution, generated-client
  // fallback or access to sources outside the descriptor and its manifests.
  const paths = [...new Set([...descriptor.files.map(([path]) => path!), "package.json", "bun.lock", "bunfig.toml",
    ...["apps/backend", "apps/web", "packages/catalog", "packages/contracts", "packages/domain", "packages/simulation"].map(path => `${path}/package.json`)])].sort();
  const texts = new Map(paths.map(path => [path, current.read(path)]));
  const tree: SourceTree = { paths, read: path => {
    const text = texts.get(path); if (text === undefined) throw Error(`Missing future baseline source: ${path}`); return text;
  } };
  return { tree, runtime: descriptor.runtime, expected: digest(descriptor) };
}

test("CURRENT working tree remains exactly reconstructable as the next slice's frozen baseline", () => {
  const { tree, runtime, expected } = futureBaseline();
  const algorithm = selectFrozenBaseline(tree, runtime, expected);
  const selected = frozenBaselineAlgorithms.find(row => row.id === algorithm);
  expect(selected).toBeDefined();
  expect(digest(selected!.reconstruct(tree, runtime))).toBe(expected);
}, 120000);

test("missing or mutated declared submission hosts cannot reconstruct the current baseline", () => {
  const { tree, runtime, expected } = futureBaseline();
  for (const name of ["submissionRoutes", "submissionQueue"]) {
    const path = `apps/backend/firstStack/${name}.ts`;
    expect(declaredExecutionHosts(tree)).toContain(path);
    const missing = { paths: tree.paths.filter(p => p !== path), read: (p: string) => {
      if (p === path) throw Error("Missing declared host"); return tree.read(p);
    } };
    expect(() => selectFrozenBaseline(missing, runtime, expected)).toThrow("Baseline descriptor does not reconstruct");
    expect(() => selectFrozenBaseline({ ...tree, read: p => tree.read(p) + (p === path ? "\n" : "") }, runtime, expected)).toThrow("Baseline descriptor does not reconstruct");
  }
}, 120000);

test("retained host declarations are literal archive data and can grow without a frozen host list", () => {
  const path = "apps/backend/executionIdentity/descriptor.ts";
  const tree = (expression: string): SourceTree => ({ paths: [path], read: () => `export const executionHosts = ${expression};` });
  const hosts = ["apps/backend/firstStack/submissionRoutes.ts", "apps/backend/firstStack/futureHost.ts"];
  expect(declaredExecutionHosts(tree(JSON.stringify(hosts)))).toEqual(hosts);
  expect(() => declaredExecutionHosts(tree("loadHosts()"))).toThrow("Missing literal retained execution hosts");
  expect(() => declaredExecutionHosts(tree('["../outside.ts"]'))).toThrow("Invalid retained execution host");
  expect(() => declaredExecutionHosts(tree('["/outside.ts"]'))).toThrow("Invalid retained execution host");
  expect(() => declaredExecutionHosts(tree('["C:/outside.ts"]'))).toThrow("Invalid retained execution host");
  expect(() => declaredExecutionHosts({ paths: [path], read: () => "export const other = [];" })).toThrow("Missing literal retained execution hosts");
});
