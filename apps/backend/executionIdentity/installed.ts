import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { ExecutionDescriptor } from "./descriptor";
import type { Instance } from "./dependencies";

// Check the actual hoisted tree, including nested instances and absent optional peers.
export function verifyInstalled(descriptor: ExecutionDescriptor, root: string) {
  const packages = new Map(descriptor.dependencies.packages.map(item => [item.id, item]));
  const directories = new Map<string, string>();
  const candidates = new Map<string, string | undefined>();
  function locate(name: string, from: string): string | undefined {
    let folder = from;
    while (folder === root || folder.startsWith(root + "/") || folder.startsWith(root + "\\")) {
      const path = join(folder, "node_modules", name, "package.json");
      if (!candidates.has(path)) candidates.set(path, existsSync(path) ? realpathSync(dirname(path)) : undefined);
      const actual = candidates.get(path);
      if (actual) {
        if (relative(root, actual).startsWith("..")) throw Error(`Execution dependency outside runtime tree: ${name}`);
        return actual;
      }
      if (folder === root) break;
      folder = dirname(folder);
    }
    return undefined;
  }
  const checked = new Set<string>();
  function selected(constraint: unknown, value: string) {
    if (!constraint) return true;
    const values = typeof constraint === "string" ? [constraint] : constraint;
    if (!Array.isArray(values) || values.some(item => typeof item !== "string")) throw Error("Unreviewed package platform constraint");
    const positive = values.filter(item => !item.startsWith("!"));
    return !values.includes(`!${value}`) && (!positive.length || positive.includes(value));
  }
  function verify(instance: Instance, directory: string) {
    const key = `${instance.id}:${directory}`;
    if (checked.has(key)) return;
    checked.add(key);
    directories.set(instance.id, directory);
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    if (manifest.name !== instance.name || instance.integrity !== "workspace" && manifest.version !== instance.version) throw Error(`Installed execution dependency drift: ${instance.id}`);
    for (const edge of instance.edges) checkEdge(edge, directory);
  }
  function checkEdge(edge: { name: string; target: string | null; kind: string }, from: string) {
    const actual = locate(edge.name, from);
    if (!edge.target) {
      if (actual) throw Error(`Unpinned optional peer is installed: ${edge.name}`);
      return;
    }
    const instance = packages.get(edge.target)!;
    if (!actual) {
      const metadata = instance.record[2];
      if (edge.kind === "optionalDependencies" && (!selected(metadata?.os, process.platform) || !selected(metadata?.cpu, process.arch))) return;
      throw Error(`Missing installed execution dependency: ${edge.target}`);
    }
    verify(instance, actual);
  }
  for (const entry of descriptor.dependencies.roots) {
    const workspace = descriptor.workspaces.find(([, manifest]) => (manifest as { name: string }).name === entry.name)?.[0] as string;
    if (!workspace) throw Error(`Missing execution workspace: ${entry.name}`);
    for (const edge of entry.edges) checkEdge(edge, resolve(root, workspace));
  }
  for (const { file, specifier } of descriptor.imports) {
    const actual = Bun.resolveSync(specifier, dirname(resolve(root, file)));
    if (relative(root, actual).startsWith("..")) throw Error(`Execution import escaped runtime tree: ${specifier}`);
    if (![...directories.values()].some(directory => actual.startsWith(directory + "/") || actual.startsWith(directory + "\\"))) throw Error(`Unpinned execution import: ${specifier}`);
  }
  return directories;
}
