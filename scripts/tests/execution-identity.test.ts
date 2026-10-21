import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ignore from "ignore";
import { diskTree, executionDescriptor, repositoryRoot } from "../../apps/backend/executionIdentity/descriptor";
import { digest } from "../../apps/backend/executionIdentity/hash";
import { parseLock } from "../../apps/backend/executionIdentity/dependencies";
import { loadTransitions, validateTransitions } from "../../apps/backend/executionIdentity/transitions";
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
// History reconstruction includes the retained source archive and a clean child-process verification.
test("history reconstructs without Git and only reviewed digests resolve", () => {
  expect(checkTransitions().current).toBe(executionSource);
  const isolated = Bun.spawnSync([process.execPath, "--no-env-file", `${repositoryRoot}/scripts/execution-identity.ts`, "--check"], {
    cwd: repositoryRoot, env: { PATH: "", SystemRoot: process.env.SystemRoot ?? "/" },
  });
  expect(isolated.exitCode).toBe(0);
  expect(JSON.parse(isolated.stdout.toString()).current).toBe(executionSource);
  const { table, pin } = loadTransitions(repositoryRoot);
  expect(table.entries.length).toBe(52);
  expect(table.entries.some((row: { commit: string }) => row.commit === "91bfe2f2b5af695f90054ec41937358be9189c04")).toBe(true);
  expect(table.entries.some((row: { commit: string }) => row.commit === "bbb769efd053b39b13db36087b3800d17b449f1e")).toBe(true);
  expect(table.entries.some((row: { commit: string }) => row.commit === "a2f2be934b9bb56a1e1b76ad0e67932541d75d30")).toBe(true);
  expect(table.entries.some((row: { commit: string }) => row.commit === "7fdc72ef9c77bb0ad44bda3134f1899e31e6e9f1")).toBe(true);
  expect(table.entries.find(row => row.commit === "ca812b96fb39c0fbb03bcfcd8d1e9b0ec80a252d")).toMatchObject({ algorithm: "isolation-boundary/1", target: executionSource });
  expect(table.entries.find(row => row.commit === "f945fa521f0c8f548edb2feb2c3928d8eacd2253")).toMatchObject({ algorithm: "isolation-boundary/1", target: executionSource });
  expect(table.entries.some((row: { commit: string }) => row.commit === "5278b1444e113040677b081a56ead1bcbb4b84d3")).toBe(true);
  expect(table.entries.some((row: { commit: string }) => row.commit === "8a33e644691199a3282dec9e0125cf08b813a786")).toBe(true);
  expect(table.entries.some((row: { commit: string }) => row.commit === "15c5448af26bfda816321dfbcd91b46ed822d6b8")).toBe(true);
  for (const commit of ["6501ad38e0b42a20a67e3122ea64ce4c886f7d63", "aa1e61271dd12c1d7bb8d18fee572e8ac1a9c500"]) expect(table.entries.some((row: { commit: string }) => row.commit === commit)).toBe(true);
  expect(table.entries.some((row: { commit: string }) => row.commit === "8141673ffcb48d0ac6d9855ea9fe46a563095cc4")).toBe(true);
  expect(table.entries.find((row: { source: string }) => row.source === "02c54db8f4bb73b5e340ae79dbfd6ece39c52360ab776ac285988e33e92e8240"))
    .toMatchObject({ commit: "3837b94eb9a388be402bde3a0ca7fac61e667942", algorithm: "analysis-boundary/1", target: executionSource });
  expect(table.entries.find((row: { source: string }) => row.source === "eb55b982fb58025a377481e44ddfc77ef0beb75771ea6c9d719d46e0208f51ef"))
    .toMatchObject({ commit: "a77220eb8409b38186bddc38576e1adf45cb460a", algorithm: "analysis-boundary/1", target: executionSource });
  for (const [commit, source] of [
    ["151bc2fc7657b4ce5809b1985e74af5b14c04b83", "43cde39b7dc2f76b51487dc5312fd6ca18fda6da8b9cba73922bf8fc96d4bebf"],
    ["bd5777e2157339f1a583fb4986843be8a046f0d2", "45396dc813a395a9dcadfc89a5cbe9e27efa2447374e177bf0db3cad503d2858"],
    ["bc5714b47270a22d1f30c052b96ed67d26512579", "f2d3b73f5acc0560ffa562870ea36ad02a6cd9936146580c0fc68ac3c79310b1"],
    ["c0df52cd00cf223029f283df711971cdff558fe8", "2d2a4ae6bfc6a9bf99f8fee4f9a0d0afba3e44e55e957e65b9e28482efb9aa6f"],
    ["31c4a92c18ae3b191eea4cedc115f2a1955959b5", "c8b2354692035a916fc98afe1c0aa4dd68c77b0c68c54871d79ce609bf1571ee"],
  ]) expect(table.entries.find((row: { source: string }) => row.source === source))
    .toMatchObject({ commit, algorithm: "analysis-boundary/1", target: executionSource });
  for (const row of table.entries) expect(compatibleReviewedSource(row.source, executionSource)).toBe(true);
  expect(compatibleReviewedSource("dcf73dace76edc0afead6158b34785f511ba6b21fd34ce5490d11fe78e20f4ad", executionSource)).toBe(true);
  expect(compatibleReviewedSource("f".repeat(64), executionSource)).toBe(false);
  expect(compatibleReviewedSource(table.entries[0]!.source, "0".repeat(64))).toBe(false);
  for (const mutate of [
    (copy: typeof table) => { copy.entries[0]!.source = "0".repeat(64); },
    (copy: typeof table) => { copy.entries[0]!.target = "0".repeat(64); },
    (copy: typeof table) => { copy.entries.pop(); },
    (copy: typeof table) => { copy.descriptors[copy.entries[0]!.descriptor]!.runtime = "bun-unknown"; },
  ]) {
    const copy = structuredClone(table); mutate(copy);
    expect(() => validateTransitions(copy, pin.digest)).toThrow();
  }
}, 120000);
test("installed execution imports resolve within the declared closure", async () => {
  expect((await checkExecutionResolution()).resolvedPackages).toBeGreaterThan(50);
}, 180000);
test("runtime image includes the identity implementation and committed transitions", () => {
  const context = ignore().add(readFileSync(".dockerignore", "utf8"));
  for (const [path] of original.files) expect(context.ignores(path!)).toBe(path!.includes("/generated/"));
  expect(readFileSync("apps/backend/Dockerfile", "utf8")).toContain("COPY apps/backend/executionIdentity ./apps/backend/executionIdentity/");
  expect(readFileSync("apps/backend/Dockerfile", "utf8")).toContain("COPY apps/backend/Dockerfile apps/backend/index.ts");
  for (const folder of ["capabilities", "runRecords"]) expect(readFileSync("apps/backend/Dockerfile", "utf8")).toContain(`COPY apps/backend/${folder} ./apps/backend/${folder}/`);
  for (const workspace of ["domain", "catalog", "contracts", "simulation"]) expect(readFileSync("apps/backend/Dockerfile", "utf8")).toContain(`COPY packages/${workspace}/tsconfig.json ./packages/${workspace}/`);
}, 120000);
