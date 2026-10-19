import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ignore from "ignore";
import { diskTree, executionDescriptor, repositoryRoot } from "../../apps/backend/executionIdentity/descriptor";
import { digest } from "../../apps/backend/executionIdentity/hash";
import { parseLock } from "../../apps/backend/executionIdentity/dependencies";
import { validateTransitions } from "../../apps/backend/executionIdentity/transitions";
import { compatibleReviewedSource } from "../../apps/backend/internalModel2/legacyCompatibility";
import { executionSource } from "../../apps/backend/internalModel2/identity";
import { checkTransitions } from "../execution-identity";
import { checkExecutionResolution } from "../execution-resolution";

const tree = diskTree(), original = executionDescriptor(tree);
function changed(edits: Record<string, string>) {
  return executionDescriptor({ paths: [...new Set([...tree.paths, ...Object.keys(edits)])], read: path => edits[path] ?? tree.read(path) });
}
test("web-only lock and manifest changes leave execution-source/2 unchanged", () => {
  const lock = parseLock(tree.read("bun.lock")), web = JSON.parse(tree.read("apps/web/package.json"));
  web.dependencies["web-only-fixture"] = "1.0.0";
  lock.workspaces["apps/web"]!.dependencies!["web-only-fixture"] = "1.0.0";
  lock.packages["web-only-fixture"] = ["web-only-fixture@1.0.0", "", {}, "sha512-Zml4dHVyZQ=="];
  expect(digest(changed({ "bun.lock": JSON.stringify(lock), "apps/web/package.json": JSON.stringify(web) }))).toBe(digest(original));
}, 120000);
test("versions, integrity, nested instances, transitive and optional peer edges are pinned", () => {
  for (const name of ["zod", "pg-connection-string", "express/content-type", "@redis/client/cluster-key-slot"]) {
    for (const field of [0, 3] as const) {
      const lock = parseLock(tree.read("bun.lock"));
      lock.packages[name]![field] = field === 0 ? `${name.includes("/") && !name.startsWith("@") ? name.split("/").at(-1) : name}@99.0.0` : "sha512-Y2hhbmdlZA==";
      expect(digest(changed({ "bun.lock": JSON.stringify(lock) }))).not.toBe(digest(original));
    }
  }
  const lock = parseLock(tree.read("bun.lock"));
  lock.packages["pg"]![2]!.dependencies!["new-transitive"] = "1.0.0";
  expect(() => changed({ "bun.lock": JSON.stringify(lock) })).toThrow("Unresolved");
  lock.packages["new-transitive"] = ["new-transitive@1.0.0", "", {}, "sha512-Zml4dHVyZQ=="];
  expect(digest(changed({ "bun.lock": JSON.stringify(lock) }))).not.toBe(digest(original));
  lock.packages["pg-native"] = ["pg-native@3.1.0", "", {}, "sha512-Zml4dHVyZQ=="];
  expect(digest(changed({ "bun.lock": JSON.stringify(lock) }))).not.toBe(digest(original));
}, 60000);
test("hoisting an identical resolved instance and its children does not change identity", () => {
  const lock = parseLock(tree.read("bun.lock"));
  for (const key of Object.keys(lock.packages).filter(key => key === "express" || key.startsWith("express/"))) {
    lock.packages[`@infraforge/backend/${key}`] = lock.packages[key]!;
    delete lock.packages[key];
  }
  expect(digest(changed({ "bun.lock": JSON.stringify(lock) }))).toBe(digest(original));
}, 120000);
test("every execution workspace dependency and imported backend source is pinned", () => {
  for (const folder of ["simulation", "domain", "catalog", "contracts"]) {
    const lock = parseLock(tree.read("bun.lock")), path = `packages/${folder}/package.json`, manifest = JSON.parse(tree.read(path));
    manifest.dependencies = { ...manifest.dependencies, zod: "4.4.3" };
    lock.workspaces[`packages/${folder}`]!.dependencies = manifest.dependencies;
    expect(digest(changed({ "bun.lock": JSON.stringify(lock), [path]: JSON.stringify(manifest) }))).not.toBe(digest(original));
  }
  for (const path of ["apps/backend/utils/config.ts", "packages/contracts/src/internal-model2/index.ts", "apps/backend/internalModel2/sandboxChild.ts"]) {
    if (path.endsWith("sandboxChild.ts") || path.endsWith("config.ts")) expect(() => changed({ [path]: tree.read(path) + "\n// execution change\n" })).toThrow("dynamic execution loader");
    else expect(digest(changed({ [path]: tree.read(path) + "\n// execution change\n" }))).not.toBe(digest(original));
  }
  expect(() => changed({ "apps/backend/internalModel2/store.ts": 'import "web-only-fixture";' })).toThrow("Undeclared");
  expect(() => changed({ "apps/backend/internalModel2/store.ts": "require(variable);" })).toThrow("dynamic execution loader");
  const manifestPath = "packages/simulation/package.json", manifest = JSON.parse(tree.read(manifestPath));
  manifest.exports["./internal-product"].node = "./src/uninventoried.ts";
  expect(() => changed({ [manifestPath]: JSON.stringify(manifest) })).toThrow("Unreviewed workspace export condition");
  const lock = parseLock(tree.read("bun.lock")); delete lock.packages.zod;
  expect(() => changed({ "bun.lock": JSON.stringify(lock) })).toThrow("Unresolved");
  expect(() => changed({ "bun.lock": JSON.stringify({ ...lock, patchedDependencies: {} }) })).toThrow("Unreviewed");
}, 60000);
test("history reconstructs without Git and only reviewed digests resolve", () => {
  expect(checkTransitions().current).toBe(executionSource);
  const isolated = Bun.spawnSync([process.execPath, "--no-env-file", `${repositoryRoot}/scripts/execution-identity.ts`, "--check"], {
    cwd: repositoryRoot, env: { PATH: "", SystemRoot: process.env.SystemRoot ?? "/" },
  });
  expect(isolated.exitCode).toBe(0);
  expect(JSON.parse(isolated.stdout.toString()).current).toBe(executionSource);
  const table = JSON.parse(readFileSync("apps/backend/executionIdentity/executionTransitions.json", "utf8"));
  const pin = JSON.parse(readFileSync("apps/backend/executionIdentity/transitionPin.json", "utf8"));
  expect(table.entries.length).toBe(29);
  for (const row of table.entries) expect(compatibleReviewedSource(row.source, executionSource)).toBe(true);
  expect(compatibleReviewedSource("dcf73dace76edc0afead6158b34785f511ba6b21fd34ce5490d11fe78e20f4ad", executionSource)).toBe(true);
  expect(compatibleReviewedSource("f".repeat(64), executionSource)).toBe(false);
  expect(compatibleReviewedSource(table.entries[0].source, "0".repeat(64))).toBe(false);
  for (const mutate of [
    (copy: typeof table) => { copy.entries[0].source = "0".repeat(64); },
    (copy: typeof table) => { copy.entries[0].target = "0".repeat(64); },
    (copy: typeof table) => { copy.entries.pop(); },
    (copy: typeof table) => { copy.descriptors[copy.entries[0].descriptor].runtime = "bun-unknown"; },
  ]) {
    const copy = structuredClone(table); mutate(copy);
    expect(() => validateTransitions(copy, pin.digest)).toThrow();
  }
}, 60000);
test("installed execution imports resolve within the declared closure", async () => {
  expect((await checkExecutionResolution()).resolvedPackages).toBeGreaterThan(50);
}, 180000);
test("runtime image includes the identity implementation and committed transitions", () => {
  const context = ignore().add(readFileSync(".dockerignore", "utf8"));
  for (const [path] of original.files) expect(context.ignores(path!)).toBe(path!.includes("/generated/"));
  expect(readFileSync("apps/backend/Dockerfile", "utf8")).toContain("COPY apps/backend/executionIdentity ./apps/backend/executionIdentity/");
  for (const workspace of ["domain", "catalog", "contracts", "simulation"]) expect(readFileSync("apps/backend/Dockerfile", "utf8")).toContain(`COPY packages/${workspace}/tsconfig.json ./packages/${workspace}/`);
}, 120000);
