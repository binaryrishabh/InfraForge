import { historicalContentHash as sha256 } from "./historical-analysis-cache";
import { readdirSync, readFileSync } from "node:fs";
import { posix, relative, resolve } from "node:path";
import { builtinModules } from "node:module";
import { dependencyClosure, parseLock, requireWorkspace } from "../apps/backend/executionIdentity/dependencies";
import type { Manifest } from "../apps/backend/executionIdentity/dependencies";
import { lf } from "../apps/backend/executionIdentity/hash";
import { configurationInventory, verifyInstallation } from "./historical-verified-configuration";
import { executable, executionImports } from "./historical-verified-loading";
import type { SourceTree } from "../apps/backend/executionIdentity/sourceTree";
export type { SourceTree } from "../apps/backend/executionIdentity/sourceTree";

export const repositoryRoot = resolve(import.meta.dir, "..");
export function diskTree(root = repositoryRoot): SourceTree {
  const paths: string[] = [];
  function walk(path: string) {
    for (const entry of readdirSync(resolve(root, path), { withFileTypes: true })) {
      if (entry.name.startsWith(".") || ["node_modules", "tests", "dist", "generated"].includes(entry.name)) continue;
      const next = path ? `${path}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(next);
      else paths.push(next);
    }
  }
  for (const path of ["apps", "packages"]) walk(path);
  paths.push("bun.lock", "package.json", "bunfig.toml", "tsconfig.base.json");
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    if (readdirSync(root).includes(name)) paths.push(name);
  }
  return { paths: paths.sort(), read: path => lf(readFileSync(resolve(root, path), "utf8")),
    resolveImport: (specifier, importer) => relative(root, Bun.resolveSync(specifier, resolve(root, posix.dirname(importer)))).replaceAll("\\", "/") };
}

const engineFolders = ["packages/simulation/src/model2/", "packages/simulation/src/reality/", "packages/domain/src/", "packages/catalog/src/"];
export function wholeLockFiles(tree: SourceTree, includeSandbox = false) {
  return tree.paths.filter(path => engineFolders.some(folder => path.startsWith(folder)) && path.endsWith(".ts") ||
    path.startsWith("apps/backend/internalModel2/") && path.endsWith(".ts") && (includeSandbox || !path.endsWith("/sandboxChild.ts")) ||
    ["packages/simulation/src/internalProduct.ts", "apps/backend/internalModel2/legacyRuntime.json", "bun.lock", "apps/backend/zod_schemas/layout.schema.ts", "apps/backend/zod_schemas/deployment.schema.ts"].includes(path)).sort();
}
export const workspacePaths = ["packages/simulation", "packages/domain", "packages/catalog", "packages/contracts"];
const builtins = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`), "bun"]);
export const packageName = (specifier: string) => specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]!;

export function verifiedHistoricalDescriptor(tree = diskTree(), runtime = `bun-${Bun.version}`) {
  const available = new Set(tree.paths), files = new Set<string>();
  const configure = configurationInventory(tree, files);
  const lock = parseLock(tree.read("bun.lock"));
  verifyInstallation(tree, Object.keys(lock.workspaces));
  const manifests = Object.fromEntries([...workspacePaths, "apps/backend"].map(path => {
    const manifest = JSON.parse(tree.read(`${path}/package.json`)) as Manifest;
    requireWorkspace(lock, path, manifest);
    return [path, manifest];
  }));
  const roots: Record<string, Record<string, string>> = {};
  for (const path of workspacePaths) roots[manifests[path]!.name] = { ...manifests[path]!.dependencies, ...manifests[path]!.optionalDependencies, ...manifests[path]!.peerDependencies };
  roots[manifests["apps/backend"]!.name] = {};
  const imports: Array<{ file: string; specifier: string }> = [];
  function local(path: string) {
    const extensions = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "json"];
    const found = [path, ...extensions.map(ext => `${path}.${ext}`), ...extensions.map(ext => `${path}/index.${ext}`)].find(candidate => available.has(candidate));
    if (!found || found.startsWith("../") || found.includes("/.env")) throw Error(`Unresolved execution source: ${path}`);
    visit(found);
  }
  function visit(path: string) {
    if (files.has(path)) return;
    files.add(path);
    if (path.endsWith(".json")) return;
    if (!executable.test(path)) throw Error(`Unsupported execution source: ${path}`);
    configure(path);
    const source = tree.read(path);
    for (const entry of executionImports(source, path)) {
      const specifier = entry.path;
      if (builtins.has(specifier)) continue;
      if (specifier.startsWith(".")) {
        local(tree.resolveImport?.(specifier, path) ?? posix.normalize(posix.join(posix.dirname(path), specifier))); continue;
      }
      const name = packageName(specifier);
      const owner = Object.keys(manifests).find(folder => path.startsWith(`${folder}/`));
      if (!owner) throw Error(`No execution workspace for ${path}`);
      const manifest = manifests[owner]!;
      const range = manifest.dependencies?.[name] ?? manifest.optionalDependencies?.[name] ?? manifest.peerDependencies?.[name];
      if (!range && name !== manifest.name) throw Error(`Undeclared execution import: ${path} -> ${specifier}`);
      roots[manifest.name]![name] = range ?? "workspace:*";
      const workspace = Object.entries(manifests).find(([, value]) => value.name === name);
      if (workspace) {
        const [folder, value] = workspace;
        const key = specifier === name ? "." : `.${specifier.slice(name.length)}`;
        const exports = value.exports as Record<string, string | { default?: string; bun?: string; import?: string }>;
        const entry = exports?.[key];
        if (entry && typeof entry === "object" && Object.keys(entry).some(condition => !["types", "default"].includes(condition))) throw Error(`Unreviewed workspace export condition: ${specifier}`);
        const target = typeof entry === "string" ? entry : entry?.default;
        if (!target) throw Error(`Unresolved workspace export: ${specifier}`);
        const expected = posix.normalize(posix.join(folder, target));
        const actual = tree.resolveImport?.(specifier, path) ?? expected;
        if (actual !== expected) throw Error(`Unexpected workspace resolution: ${path} -> ${specifier}: ${actual}`);
        local(actual);
      } else imports.push({ file: path, specifier });
    }
  }
  for (const path of wholeLockFiles(tree).filter(path => path !== "bun.lock")) visit(path);
  for (const path of tree.paths.filter(path => path.startsWith("packages/contracts/src/") && path.endsWith(".ts"))) visit(path);
  for (const path of ["tsconfig.base.json", "apps/backend/tsconfig.json"]) visit(path);
  // The sandbox child is an explicit dynamic entrypoint, with its own image provenance as well.
  visit("apps/backend/internalModel2/sandboxChild.ts");
  const dependencies = dependencyClosure(lock, roots);
  const install = Bun.TOML.parse(tree.read("bunfig.toml"));
  const root = JSON.parse(tree.read("package.json"));
  for (const [name, version] of Object.entries(dependencies.overrides)) if (root.overrides?.[name] !== version) throw Error(`Stale execution override: ${name}`);
  for (const name of Object.keys(root.overrides ?? {})) {
    if (name.slice(1).includes("@")) throw Error(`Unreviewed scoped override: ${name}`);
    if (dependencies.packages.some(item => item.name === name) && lock.overrides?.[name] !== root.overrides[name]) throw Error(`Unresolved execution override: ${name}`);
  }
  const workspaces = Object.entries(manifests).map(([path, value]) => {
    const { devDependencies: _dev, scripts: _scripts, ...manifest } = value;
    // Backend dependency roots are imports, not unrelated API-only packages.
    return [path, path === "apps/backend" ? { ...manifest, dependencies: roots[value.name] } : manifest];
  });
  return { schema: "execution-source/2", runtime, files: [...files].sort().map(path => [path, sha256(tree.read(path))]),
    workspaces, dependencies, settings: { install, packageManager: root.packageManager }, imports: imports.sort((a, b) => `${a.file}:${a.specifier}`.localeCompare(`${b.file}:${b.specifier}`)) };
}
export type ExecutionDescriptor = ReturnType<typeof verifiedHistoricalDescriptor>;
