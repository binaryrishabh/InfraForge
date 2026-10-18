// Frozen descriptor algorithm from the first v2 migration; never use for current execution.
import { readdirSync, readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { builtinModules } from "node:module";
import { dependencyClosure, parseLock, requireWorkspace } from "../apps/backend/executionIdentity/dependencies";
import type { Manifest } from "../apps/backend/executionIdentity/dependencies";
import { lf, sha256 } from "../apps/backend/executionIdentity/hash";

export interface SourceTree { paths: string[]; read(path: string): string }
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
  for (const path of ["apps/backend", "packages"]) walk(path);
  paths.push("bun.lock", "package.json", "bunfig.toml", "tsconfig.base.json");
  return { paths: paths.sort(), read: path => lf(readFileSync(resolve(root, path), "utf8")) };
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

export function historicalDescriptor(tree: SourceTree, runtime = `bun-${Bun.version}`) {
  const available = new Set(tree.paths), files = new Set<string>();
  const lock = parseLock(tree.read("bun.lock"));
  const manifests = Object.fromEntries([...workspacePaths, "apps/backend"].map(path => {
    const manifest = JSON.parse(tree.read(`${path}/package.json`)) as Manifest;
    requireWorkspace(lock, path, manifest);
    return [path, manifest];
  }));
  const roots: Record<string, Record<string, string>> = {};
  for (const path of workspacePaths) roots[manifests[path]!.name] = { ...manifests[path]!.dependencies, ...manifests[path]!.optionalDependencies, ...manifests[path]!.peerDependencies };
  roots[manifests["apps/backend"]!.name] = {};
  const imports: Array<{ file: string; specifier: string }> = [];
  const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun" });
  function local(path: string) {
    const found = [path, `${path}.ts`, `${path}.tsx`, `${path}/index.ts`].find(candidate => available.has(candidate));
    if (!found || found.startsWith("../") || found.includes("/.env")) throw Error(`Unresolved execution source: ${path}`);
    visit(found);
  }
  function visit(path: string) {
    if (files.has(path)) return;
    files.add(path);
    if (!/\.tsx?$/.test(path)) return;
    const source = tree.read(path);
    // Nonliteral module loading needs an explicit, reviewed entrypoint inventory.
    if (/\b(?:import|require)\s*\(\s*[^\s'"`]/.test(source)) throw Error(`Dynamic execution import: ${path}`);
    for (const entry of transpiler.scan(source).imports) {
      const specifier = entry.path;
      if (builtins.has(specifier)) continue;
      if (specifier.startsWith(".")) { local(posix.normalize(posix.join(posix.dirname(path), specifier))); continue; }
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
        local(posix.join(folder, target));
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
  if (root.patchedDependencies || root.trustedDependencies || root.scripts?.postinstall || root.scripts?.preinstall || root.packageExtensions) throw Error("Unreviewed root install hooks/settings");
  for (const [name, version] of Object.entries(dependencies.overrides)) if (root.overrides?.[name] !== version) throw Error(`Stale execution override: ${name}`);
  for (const name of Object.keys(root.overrides ?? {})) {
    if (name.slice(1).includes("@")) throw Error(`Unreviewed scoped override: ${name}`);
    if (dependencies.packages.some(item => item.name === name) && lock.overrides?.[name] !== root.overrides[name]) throw Error(`Unresolved execution override: ${name}`);
  }
  const workspaces = Object.entries(manifests).map(([path, value]) => {
    const scripts = value.scripts as Record<string, string> | undefined;
    if (scripts?.preinstall || scripts?.install || scripts?.postinstall || value.patchedDependencies || value.trustedDependencies) throw Error(`Unreviewed workspace install hook: ${path}`);
    const { devDependencies: _dev, scripts: _scripts, ...manifest } = value;
    // Backend dependency roots are imports, not unrelated API-only packages.
    return [path, path === "apps/backend" ? { ...manifest, dependencies: roots[value.name] } : manifest];
  });
  return { schema: "execution-source/2", runtime, files: [...files].sort().map(path => [path, sha256(tree.read(path))]),
    workspaces, dependencies, settings: { install, packageManager: root.packageManager }, imports: imports.sort((a, b) => `${a.file}:${a.specifier}`.localeCompare(`${b.file}:${b.specifier}`)) };
}
export type ExecutionDescriptor = ReturnType<typeof historicalDescriptor>;
