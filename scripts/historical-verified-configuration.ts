import { posix } from "node:path";
import type { SourceTree } from "../apps/backend/executionIdentity/sourceTree";

export function configurationInventory(tree: SourceTree, files: Set<string>) {
  const available = new Set(tree.paths), checked = new Set<string>(), active = new Set<string>();
  function config(path: string) {
    if (active.has(path)) throw Error(`Cyclic execution config: ${path}`);
    if (checked.has(path)) return;
    if (path.startsWith("../") || !available.has(path)) throw Error(`Unresolved execution config: ${path}`);
    active.add(path);
    const parsed = Bun.JSONC.parse(tree.read(path));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw Error(`Invalid execution config: ${path}`);
    const value = parsed as { compilerOptions?: Record<string, unknown>; extends?: unknown };
    const options = value.compilerOptions ?? {};
    if (typeof options !== "object" || Array.isArray(options)) throw Error(`Invalid execution config options: ${path}`);
    // Aliases and alternative resolution conditions need a separate resolver contract.
    for (const key of ["paths", "baseUrl", "rootDirs", "moduleSuffixes", "customConditions", "plugins", "jsxImportSource", "jsxFactory", "jsxFragmentFactory"]) {
      if (key in options) throw Error(`Unsupported execution config ${key}: ${path}`);
    }
    for (const parent of value.extends === undefined ? [] : Array.isArray(value.extends) ? value.extends : [value.extends]) {
      if (typeof parent !== "string" || !parent.startsWith(".")) throw Error(`Unsupported execution config extends: ${path}`);
      let next = posix.normalize(posix.join(posix.dirname(path), parent));
      if (!next.endsWith(".json")) next += ".json";
      config(next);
    }
    active.delete(path); checked.add(path); files.add(path);
  }
  return (file: string) => {
    let folder = posix.dirname(file);
    for (;;) {
      for (const name of ["tsconfig.json", "jsconfig.json"]) {
        const path = folder === "." ? name : `${folder}/${name}`;
        if (available.has(path)) config(path);
      }
      if (folder === ".") break;
      folder = posix.dirname(folder);
    }
  };
}

const lifecycle = new Set(["preinstall", "install", "postinstall", "preprepare", "prepare", "postprepare", "preuninstall", "uninstall", "postuninstall", "prepublish", "prepublishOnly", "publish", "postpublish", "prepack", "postpack"]);
export function verifyInstallManifest(manifest: Record<string, unknown>, path: string) {
  const scripts = manifest.scripts as Record<string, unknown> | undefined;
  if (Object.keys(scripts ?? {}).some(key => lifecycle.has(key)) || manifest.patchedDependencies || manifest.trustedDependencies || manifest.packageExtensions) throw Error(`Unreviewed install hooks/settings: ${path}`);
}

export function verifyInstallation(tree: SourceTree, lockedWorkspaces: string[]) {
  const root = JSON.parse(tree.read("package.json"));
  verifyInstallManifest(root, "package.json");
  if (!Array.isArray(root.workspaces) || root.workspaces.some((pattern: unknown) => typeof pattern !== "string" || pattern.startsWith("!") || pattern.includes(".."))) throw Error("Unsupported install workspace inventory");
  const patterns = root.workspaces.map((pattern: string) => new Bun.Glob(pattern));
  const workspaces = tree.paths.filter(path => path.endsWith("/package.json"))
    .map(path => path.slice(0, -"/package.json".length)).filter(path => patterns.some((pattern: Bun.Glob) => pattern.match(path))).sort();
  if (JSON.stringify(workspaces) !== JSON.stringify(lockedWorkspaces.filter(Boolean).sort())) throw Error("Stale install workspace inventory");
  for (const workspace of workspaces) verifyInstallManifest(JSON.parse(tree.read(`${workspace}/package.json`)), `${workspace}/package.json`);
}
