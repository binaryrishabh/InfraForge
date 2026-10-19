import { expect, test } from "bun:test";
import { diskTree, executionDescriptor, repositoryRoot } from "../../apps/backend/executionIdentity/descriptor";
import { digest } from "../../apps/backend/executionIdentity/hash";
import { parseLock } from "../../apps/backend/executionIdentity/dependencies";
import { executionImports, verifyModuleLoading, verifyInstalledModuleLoading } from "../../apps/backend/executionIdentity/loading";
import { loadTransitions } from "../../apps/backend/executionIdentity/transitions";
import { checkExecutionResolution } from "../execution-resolution";
import { checkTransitions } from "../execution-identity";

const tree = diskTree(), original = executionDescriptor(tree);
function changed(edits: Record<string, string>) {
  return executionDescriptor({ paths: [...new Set([...tree.paths, ...Object.keys(edits)])], read: path => edits[path] ?? tree.read(path) });
}

test("nested configs cannot redirect a workspace import to an alternate engine", () => {
  const config = "apps/backend/internalModel2/tsconfig.json";
  const alternate = "packages/simulation/src/review-engine.ts";
  expect(() => changed({ [config]: JSON.stringify({ compilerOptions: { paths: { "@infraforge/simulation/internal-product": ["../../../packages/simulation/src/review-engine.ts"] } } }),
    [alternate]: 'export * from "./internalProduct"; export function compileProduct() { throw Error("alternate-engine"); }' })).toThrow("Unsupported execution config paths");
  for (const location of [config, "tsconfig.json", "packages/simulation/src/tsconfig.json", "packages/domain/src/jsconfig.json"]) {
    expect(digest(changed({ [location]: '{"compilerOptions":{"target":"ES2020"}}' }))).not.toBe(digest(original));
  }
  expect(digest(changed({ "packages/contracts/tsconfig.json": tree.read("packages/contracts/tsconfig.json") + "\n" }))).not.toBe(digest(original));
  const extension = "apps/backend/internalModel2/resolution.json";
  const base = { [config]: '{"extends":"./resolution.json"}', [extension]: '{"compilerOptions":{"target":"ES2020"}}' };
  expect(digest(changed(base))).not.toBe(digest(changed({ ...base, [extension]: '{"compilerOptions":{"target":"ES2022"}}' })));
  expect(() => changed({ ...base, [extension]: '{"extends":"./tsconfig.json"}' })).toThrow("Cyclic");
  expect(() => changed({ [config]: '{"extends":"unreviewed-package/config"}' })).toThrow("Unsupported");
  expect(() => executionDescriptor({ ...tree, resolveImport: (specifier, importer) => specifier === "@infraforge/simulation/internal-product" ? alternate : tree.resolveImport!(specifier, importer) })).toThrow("Unexpected workspace resolution");
}, 120000);

test("a second JavaScript module and its package imports belong to the closure", () => {
  for (const extension of ["js", "mjs", "cjs", "jsx", "mts", "cts"]) {
    const bridge = `apps/backend/internalModel2/review-bridge.${extension}`, leaf = `apps/backend/internalModel2/review-leaf.${extension}`;
    const edits = { "apps/backend/internalModel2/store.ts": `import "./review-bridge.${extension}";`, [bridge]: `import "./review-leaf.${extension}";`, [leaf]: "export const value = 1;" };
    const descriptor = changed(edits);
    expect(descriptor.files.some(([path]) => path === leaf)).toBe(true);
    expect(digest(descriptor)).not.toBe(digest(changed({ ...edits, [leaf]: "export const value = 99;" })));
    expect(() => changed({ ...edits, [leaf]: 'import "three";' })).toThrow("Undeclared execution import");
  }
  {
    const edits = { "apps/backend/internalModel2/store.ts": 'import("./review-leaf.js");', "apps/backend/internalModel2/review-leaf.js": "export const value = 1;" };
    expect(digest(changed(edits))).not.toBe(digest(changed({ ...edits, "apps/backend/internalModel2/review-leaf.js": "export const value = 99;" })));
  }
  expect(() => changed({ "apps/backend/internalModel2/store.ts": 'require("./review-leaf.js");' })).toThrow("dynamic execution loader");
  for (const source of ['import("three");', 'import(`th${"ree"}`);']) expect(() => changed({ "apps/backend/internalModel2/store.ts": source })).toThrow("Undeclared execution import");
}, 120000);

test("the build rejects authored modules missing from the descriptor", async () => {
  const incomplete = structuredClone(original);
  incomplete.files = incomplete.files.filter(([path]) => path !== "apps/backend/utils/config.ts");
  await expect(checkExecutionResolution(incomplete)).rejects.toThrow("Uninventoried authored execution module");
  const missingImport = structuredClone(original);
  missingImport.imports = missingImport.imports.filter(item => item.specifier !== "pg");
  await expect(checkExecutionResolution(missingImport)).rejects.toThrow("Uninventoried authored import");
}, 180000);

const escapedLoaders = [
  'import { createRequire } from "node:module"; const load = createRequire(import.meta.url); load("three");',
  'import { createRequire as factory } from "module"; factory(import.meta.url)("three");',
  'import * as mod from "node:module"; mod["createRequire"](import.meta.url)("three");',
  'const load = require; load("three");',
  'const load = requ\\u0069re; load("three");',
  'const resolve = require.resolve; resolve("three");',
  'const load = module.require.bind(module); load("three");',
  'const m = module; m["requ" + "ire"]("three");',
  'globalThis["require"]("three");',
  'globalThis["requ" + "ire"]("three");',
  'const host = globalThis; host["require"]("three");',
  'process.getBuiltinModule("module").createRequire(import.meta.url)("three");',
  'const { plugin } = require("bun"); plugin({setup() {}});',
  'require(variable);',
  'import(variable);',
  'import(`th${suffix}`);',
  'const load = (() => {}).constructor("return import(\\"three\\")"); load();',
  'const load = (() => {})["constructor"]; load("return import(\\"three\\")")();',
  'const { constructor: load } = () => {}; load("return import(\\"three\\")")();',
  'Reflect.get(() => {}, "constructor")("return import(\\"three\\")")();',
  'Object.getOwnPropertyDescriptor(Object.getPrototypeOf(() => {}), "constructor").value("return import(\\"three\\")")();',
  'import vm from "node:vm"; vm.runInThisContext("require(\\"three\\")");',
  'const vm = require("vm"); vm.runInThisContext("require(\\"three\\")");',
  'import { Worker } from "node:worker_threads"; new Worker("/untracked.js");',
  'new Worker("/untracked.js");',
  'import inspector from "node:inspector"; new inspector.Session();',
  'import { spawn } from "node:child_process"; spawn("bun", ["/untracked.js"]);',
  'Bun.spawn(["bun", "/untracked.js"]);',
  'process.binding("natives");',
];
test("loader values cannot escape in authored or installed package modules", () => {
  for (const source of escapedLoaders) {
    expect(() => changed({ "apps/backend/internalModel2/store.ts": source })).toThrow("dynamic execution loader");
    expect(() => verifyInstalledModuleLoading(source, "/fixture/node_modules/pg/index.js", "pg/index.js")).toThrow("Unreviewed dynamic package loader");
    // An existing reviewed file does not exempt different bytes.
    expect(() => verifyInstalledModuleLoading(source, "/fixture/node_modules/express/lib/view.js", "express/lib/view.js")).toThrow("Unreviewed dynamic package loader");
  }
  const cachedPath = "cache-regression.js", valid = 'import("./review-leaf.js");';
  verifyModuleLoading(valid, cachedPath);
  expect(() => verifyModuleLoading('const load = require; load("three");', cachedPath)).toThrow();
  expect(executionImports(valid, cachedPath).some(item => item.path === "./review-leaf.js")).toBe(true);
  for (const path of ["apps/backend/internalModel2/dockerConnection.ts", "apps/backend/utils/errors.ts"]) {
    expect(() => changed({ [path]: tree.read(path) + "\n" })).toThrow("dynamic execution loader");
  }
}, 120000);

test("installation hooks are refused for the root and every installed workspace", () => {
  const lock = parseLock(tree.read("bun.lock"));
  for (const workspace of Object.keys(lock.workspaces)) {
    const path = workspace ? `${workspace}/package.json` : "package.json";
    const manifest = JSON.parse(tree.read(path));
    for (const phase of ["preinstall", "install", "postinstall", "preprepare", "prepare", "postprepare", "preuninstall", "uninstall", "postuninstall", "prepublish", "prepublishOnly", "prepack", "postpack", "publish", "postpublish"]) {
      expect(() => changed({ [path]: JSON.stringify({ ...manifest, scripts: { ...manifest.scripts, [phase]: "bun -e 'throw Error()'" } }) })).toThrow("Unreviewed install hooks/settings");
    }
  }
  const web = JSON.parse(tree.read("apps/web/package.json"));
  expect(digest(changed({ "apps/web/package.json": JSON.stringify({ ...web, scripts: { ...web.scripts, unrelated: "echo web" } }) }))).toBe(digest(original));
}, 120000);

test("runtime and tooling share LF-normalized transition byte validation", () => {
  const table = tree.read("apps/backend/executionIdentity/executionTransitions.json");
  const pin = tree.read("apps/backend/executionIdentity/transitionPin.json");
  const read = (text: string) => (path: string) => path.endsWith("transitionPin.json") ? pin : text;
  expect(loadTransitions("fixture", read(table.replaceAll("\n", "\r\n"))).mappings.size).toBeGreaterThan(0);
  for (const mutated of [table + "\n", table.trim(), JSON.stringify(JSON.parse(table))]) {
    expect(() => loadTransitions("fixture", read(mutated))).toThrow("Execution transition bytes changed");
    expect(() => checkTransitions("fixture", read(mutated))).toThrow("Execution transition bytes changed");
  }
}, 120000);
