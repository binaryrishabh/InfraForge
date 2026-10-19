import { expect, test } from "bun:test";
import { executionDescriptor, diskTree, repositoryRoot } from "../../apps/backend/executionIdentity/descriptor";
import { digest, sourceHash, sha256 } from "../../apps/backend/executionIdentity/hash";
import { verifyModuleLoading, verifyInstalledModuleLoading } from "../../apps/backend/executionIdentity/loading";
import { parseLock } from "../../apps/backend/executionIdentity/dependencies";
import { fixture } from "../../apps/backend/tests/integration/lessonSandboxChecks";
import { fixture as hostFixture } from "../lesson-host/fixture";
import { retireInternalRuns } from "../../apps/backend/internalModel2/execution";
import { verifyResolutionSelections } from "../../apps/backend/executionIdentity/installed";
import { resolve } from "node:path";
import { verifyLaunch } from "../../apps/backend/executionIdentity/launch";

const tree = diskTree();
function changed(edits: Record<string, string>) {
  return executionDescriptor({ paths: [...new Set([...tree.paths, ...Object.keys(edits)])], read: path => edits[path] ?? tree.read(path),
    resourceBytes: path => Buffer.from(edits[path] ?? tree.read(path)).toString("base64") });
}
const original = executionDescriptor(tree);

test.each([
  `self.Function("return import('three')")();`,
  `window.Function("return import('three')")();`,
  `self.eval("import('three')");`,
  `unknownExecutionHost.Function("return import('three')")();`,
])("free global aliases cannot construct execution code: %s", source => {
  expect(() => verifyModuleLoading(source, "global-alias-fixture.ts")).toThrow("dynamic execution loader");
  expect(() => verifyInstalledModuleLoading(source, "/fixture/node_modules/pg/lib/client.js", "pg/lib/client.js")).toThrow("dynamic package loader");
});

test("free names fail closed even in typeof, shorthand, initializers and separate scopes", () => {
  for (const source of [
    "typeof self;", "const value = { unknownExecutionHost };", "frames; top; parent;",
    "process.version;", "Bun.version;", "require('./leaf');", "module.exports;",
    "function f(value = unknownExecutionHost) { var unknownExecutionHost = {}; }",
    "switch (unknownExecutionHost) { case 1: let unknownExecutionHost; }",
    "class Local { static { var unknownExecutionHost = {}; } } unknownExecutionHost;",
    "try {} catch (unknownExecutionHost) {} unknownExecutionHost;",
    "{ let unknownExecutionHost = {}; } unknownExecutionHost;",
    "for (let unknownExecutionHost of []) {} unknownExecutionHost;",
  ]) expect(() => verifyModuleLoading(source, "global-scope-fixture.ts")).toThrow("dynamic execution loader");
});

test("local bindings and non-reference identifier names need no global capability", () => {
  for (const source of [
    `import {join as self} from 'node:path'; const path = self('a', 'b'); export {path as window};`,
    `function use({self: window}, ...parent) { const {value: frames = window} = parent; return frames; }`,
    `const self = function window() { return window; }; const parent = class frames { method() { return frames; } };`,
    `try { throw 1; } catch (self) { const window = self; }`,
    `const value = {self: 1, window() { return this.self; }}; value.self; outer: for (;;) { break outer; }`,
  ]) expect(() => verifyModuleLoading(source, "local-scope-fixture.ts")).not.toThrow();
});

test("an existing execution file passes without an exact-byte global exception", () => {
  const path = "packages/simulation/src/model2/random.ts";
  expect(original.files.some(([file]) => file === path)).toBe(true);
  expect(() => verifyModuleLoading(tree.read(path), path)).not.toThrow();
  expect(() => verifyModuleLoading(tree.read(path) + "\n// ordinary execution edit\n", path)).not.toThrow();
  const host = "apps/backend/utils/config.ts";
  expect(() => verifyModuleLoading(tree.read(host), host)).not.toThrow();
  expect(() => verifyModuleLoading(tree.read(host) + "\n// invalidates host review\n", host)).toThrow("dynamic execution loader");
});

test("computed and aliased reflection cannot create an untracked loader in either module policy", () => {
  const sources = [
    `const key = 'con' + 'structor'; const load = (() => {})[key]("return import('three')"); load();`,
    `const key = String.fromCharCode(99,111,110,115,116,114,117,99,116,111,114); const fn = () => {}; const alias = fn; alias[key]("return import('three')")();`,
    `const object = {}; const load = object[process.env.KEY]; load("return import('three')")();`,
    `const reflect = Reflect; reflect.get(() => {}, 'constructor')("return import('three')")();`,
    `const object = Object; object.getPrototypeOf(() => {}).constructor("return import('three')")();`,
    `globalThis.WebAssembly.compile(new Uint8Array());`,
    `Symbol={iterator:'constructor'}; (()=>{})[Symbol.iterator]("return import('three')")();`,
    `Error.prepareStackTrace = (_, frames) => frames[1].getFunction();`,
    `const E=Error; E.prepareStackTrace = (_, frames) => frames[1].getFunction();`,
    `const load=(function(){})['caller']; load('three');`,
    `RegExp.prototype.toString = () => 'constructor'; (() => {})[/key/]("return import('three')")();`,
  ];
  for (const source of sources) {
    for (const version of ["0.186.0", "99.0.0"]) {
      const lock = parseLock(tree.read("bun.lock"));
      lock.packages.three![0] = `three@${version}`;
      expect(() => changed({ "apps/backend/internalModel2/store.ts": source, "bun.lock": JSON.stringify(lock) })).toThrow("dynamic execution loader");
    }
    expect(() => verifyInstalledModuleLoading(source, "/fixture/node_modules/pg/lib/client.js", "pg/lib/client.js")).toThrow("dynamic package loader");
  }
}, 120000);

test("fresh processes reject alternative resolution conditions and loading options", () => {
  const env = Object.fromEntries(["PATH", "SystemRoot", "TEMP", "TMP"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
  for (const flags of [[], ["--conditions=browser"], ["--conditions", "browser"]]) {
    const result = Bun.spawnSync([process.execPath, "--no-env-file", ...flags, `${repositoryRoot}/scripts/tests/fixtures/execution-launch-probe.ts`], { cwd: repositoryRoot, env });
    expect(result.exitCode === 0).toBe(flags.length === 0);
    if (flags.length) expect(result.stderr.toString()).toContain("Unreviewed execution launch option");
  }
  for (const args of [["--no-env-file", "--eval", "untracked"], ["--preload", "untracked.ts"], ["--define", "x=1"], ["--tsconfig-override", "untracked.json"], ["--hot"]]) expect(() => verifyLaunch(args, {})).toThrow();
  for (const key of ["NODE_OPTIONS", "BUN_OPTIONS", "BUN_PRELOAD"]) expect(() => verifyLaunch([], { [key]: "untracked" })).toThrow();
  expect(() => changed({ "bunfig.toml": 'preload = ["./untracked.ts"]\n' + tree.read("bunfig.toml") })).toThrow();
  expect(() => changed({ "apps/backend/internalModel2/bunfig.toml": 'preload = ["./untracked.ts"]' })).toThrow();
  for (const path of ["apps/backend/Dockerfile", "apps/backend/docker-compose.yml", ".dockerignore"]) expect(digest(changed({ [path]: tree.read(path) + "\n# launch edit\n" }))).not.toBe(digest(original));
}, 60000);

test("real hosts, injected ownership, schema and generator inputs cannot change under one identity", () => {
  for (const path of ["apps/backend/infra/workerOwnership.ts", "apps/backend/worker.ts", "apps/backend/prisma/schema.prisma", "apps/backend/prisma.config.ts"]) {
    const value = tree.read(path) + "\n// alternate host or generator\n";
    if (path.endsWith("schema.prisma")) expect(digest(changed({ [path]: value }))).not.toBe(digest(original));
    else expect(() => changed({ [path]: value })).toThrow("Unreviewed");
    expect(original.files.some(([file]) => file === path)).toBe(true);
  }
  const ownership = "apps/backend/infra/workerOwnership.ts";
  expect(() => changed({ [ownership]: tree.read(ownership).replace('await this.client.query("BEGIN");', 'throw Error("alternate-host");') })).toThrow("Unreviewed execution capability import");
  expect(() => changed({ "apps/backend/lib/generated/prisma/internal/class.ts": tree.read("apps/backend/lib/generated/prisma/internal/class.ts") + "\n// generated mutation\n" })).toThrow();
}, 120000);

test("resource access is enumerable and JSON/WASM content changes identity", () => {
  const sources = [
    `import fs from 'node:fs'; const value = JSON.parse(fs.readFileSync(new URL('../executionIdentity/review-data.json',import.meta.url),'utf8'));`,
    `import { readFileSync as read } from 'fs'; read(process.env.PATH_TO_INPUT);`,
    `Bun.file(process.env.PATH_TO_INPUT).arrayBuffer().then(WebAssembly.compile);`,
    `const host = Bun; host['fi'+'le']('untracked.wasm');`,
    `fetch('file:///untracked.json').then(r=>r.json());`,
  ];
  for (const source of sources) {
    for (const content of ['{"value":1}', '{"value":99}']) expect(() => changed({ "apps/backend/internalModel2/store.ts": source, "apps/backend/executionIdentity/review-data.json": content })).toThrow("dynamic execution loader");
    expect(() => verifyInstalledModuleLoading(source, "/fixture/node_modules/pg/lib/client.js", "pg/lib/client.js")).toThrow("dynamic package loader");
  }
  const wasm = (value: number) => String.fromCharCode(0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,7,10,1,6,97,110,115,119,101,114,0,0,10,6,1,4,0,65,value,11);
  for (const value of [1, 2]) {
    const bytes = Uint8Array.from(wasm(value), character => character.charCodeAt(0));
    const answer = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports.answer as () => number;
    expect(answer()).toBe(value);
  }
  for (const [extension, values] of [["json", ['{"value":1}', '{"value":99}']], ["wasm", [wasm(1), wasm(2)]]] as const) {
    const path = `apps/backend/resources/fixture.${extension}`;
    const base = { "apps/backend/executionIdentity/resourceInventory.json": JSON.stringify([path]), [path]: values[0] };
    const first = changed(base), second = changed({ ...base, [path]: values[1] });
    expect(first.resources.some(([file]) => file === path)).toBe(true);
    expect(digest(first)).not.toBe(digest(second));
  }
  expect(() => changed({ "apps/backend/executionIdentity/resourceInventory.json": '["../untracked.json"]' })).toThrow();
}, 120000);

test("Three changes and ordinary web edits stay identity-neutral", () => {
  const source = tree.paths.find(path => path.startsWith("apps/web/src/") && path.endsWith(".tsx"))!;
  expect(source).toBeDefined();
  expect(digest(changed({ [source]: tree.read(source) + "\n// frontend-only edit\n" }))).toBe(digest(original));
  const lock = parseLock(tree.read("bun.lock")), web = JSON.parse(tree.read("apps/web/package.json"));
  lock.packages.three![0] = "three@99.0.0";
  expect(digest(changed({ "bun.lock": JSON.stringify(lock), "apps/web/src/identity-fixture.ts": "export const revision = 99;" }))).toBe(digest(original));
  delete lock.packages.three; delete lock.workspaces["apps/web"]!.dependencies!.three; delete web.dependencies.three;
  expect(digest(changed({ "bun.lock": JSON.stringify(lock), "apps/web/package.json": JSON.stringify(web) }))).toBe(digest(original));
}, 120000);


test("the immutable containment probe has an exact review, not a child-path exemption", () => {
  const path = "apps/backend/internalModel2/sandboxChild.ts";
  for (const source of [fixture, hostFixture]) {
    expect(digest(changed({ [path]: source }))).not.toBe(digest(original));
    expect(digest(changed({ [path]: source.replaceAll("\n", "\r\n") }))).toBe(digest(changed({ [path]: source })));
    expect(() => changed({ [path]: source + "\n// probe edit\n" })).toThrow("dynamic execution loader");
  }
}, 120000);

test("source reviews and descriptors normalize LF while resource bytes remain exact", () => {
  const path = "apps/backend/utils/config.ts", source = tree.read(path), crlf = source.replaceAll("\n", "\r\n");
  expect(sourceHash(source)).toBe(sourceHash(crlf));
  expect(sha256(source)).not.toBe(sha256(crlf));
  expect(() => verifyModuleLoading(crlf, path)).not.toThrow();
  expect(() => verifyModuleLoading(crlf + "\r\n// edit", path)).toThrow();
  expect(digest(executionDescriptor({ ...tree, read: file => tree.read(file).replaceAll("\n", "\r\n") }))).toBe(digest(original));
  const installed = "import {value} from './value'; export {value};\n";
  expect(() => verifyInstalledModuleLoading(installed.replaceAll("\n", "\r\n"), "/fixture/pure.js", "pure.js")).not.toThrow();
}, 120000);

test("descriptor construction analyses source without executing application modules", () => {
  const path = "packages/simulation/src/model2/random.ts";
  expect(() => changed({ [path]: tree.read(path) + '\nthrow Error("application code must not execute in metadata checks");\n' })).not.toThrow();
});


test("privileged resources and loaders cannot escape through verifier helpers, re-exports or package wrappers", () => {
  const readers = [
    `import {diskTree} from '../executionIdentity/descriptor'; export const value=JSON.parse(diskTree().read('apps/backend/resources/review-data.json'));`,
    `import express from 'express'; export const reader=express.static('/fixture');`,
    `import {DockerConnection} from './dockerConnection'; DockerConnection.use(c=>c.run(['exec','fixture','cat','/input']));`,
  ];
  for (const source of readers) for (const value of [1,99]) expect(() => changed({ 'apps/backend/internalModel2/store.ts': source, 'apps/backend/resources/review-data.json': JSON.stringify({value}) })).toThrow('Unreviewed execution capability import');
  expect(() => changed({ 'apps/backend/internalModel2/store.ts': `import {reader} from './review-reader'; reader().read('/input');`, 'apps/backend/internalModel2/review-reader.ts': `export {diskTree as reader} from '../executionIdentity/descriptor';` })).toThrow('Unreviewed execution capability import');
  for (const source of [`import.meta.resolve('three');`, `const meta=import.meta; meta.resolve('three');`]) expect(() => changed({'apps/backend/internalModel2/store.ts':source})).toThrow('dynamic execution loader');
  expect(() => changed({'apps/backend/internalModel2/store.ts':`require.resolve('three');`})).toThrow('dynamic execution loader');
}, 120000);


test("unrecognized drivers cannot claim the ordinary backend host identity or inject ownership", async () => {
  const child = Bun.spawnSync([process.execPath, "--no-env-file", `${repositoryRoot}/scripts/tests/fixtures/unreviewed-host.ts`], { cwd: repositoryRoot, env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "/" } });
  expect(child.exitCode).not.toBe(0);
  expect(child.stderr.toString()).toContain("Unreviewed execution entrypoint");
  let used = false;
  await expect(retireInternalRuns({ transaction: async () => { used = true; } } as never)).rejects.toThrow("Unreviewed Model-2 execution host");
  expect(used).toBe(false);
}, 120000);


test("deduplicated resolution still checks every target and separates require/import conditions", () => {
  const root=resolve(repositoryRoot,"scripts/tests/fixtures/virtual"), directory=resolve(root,"package");
  const directories=new Map([["pkg",directory]]), edge={owner:"pkg",file:"a.js",specifier:"dependency",kind:"require-call",targetOwner:"pkg",targetFile:"require.js"};
  const resolver=(_name:string,_from:string,kind:string)=>resolve(directory,kind==="require-call" ? "require.js" : "import.js");
  expect(()=>verifyResolutionSelections([edge,{...edge,file:"b.js",kind:"import-statement",targetFile:"import.js"}],directories,root,resolver,path=>path)).not.toThrow();
  expect(()=>verifyResolutionSelections([edge,{...edge,file:"b.js",targetFile:"other.js"}],directories,root,resolver,path=>path)).toThrow("Selected execution entrypoint drift");
}, 120000);
