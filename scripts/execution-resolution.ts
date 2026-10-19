import { executionResolve } from "../apps/backend/executionIdentity/resolution";
import { builtinModules } from "node:module";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { sourceHash, lf } from "../apps/backend/executionIdentity/hash";
import { executionDescriptor, executionHosts, packageName, repositoryRoot } from "../apps/backend/executionIdentity/descriptor";
import type { ExecutionDescriptor } from "../apps/backend/executionIdentity/descriptor";
import { verifyInstalled } from "../apps/backend/executionIdentity/installed";
import { executable, loaderFor, verifyInstalledModuleLoading } from "../apps/backend/executionIdentity/loading";

// Compile without executing application code. Every package import must belong to its locked owner.
export async function checkExecutionResolution(descriptor: ExecutionDescriptor = executionDescriptor(), root = repositoryRoot, review = false) {
  const directories = verifyInstalled(descriptor, root, review);
  const inventory = new Map(descriptor.files as [string, string][]), authored = new Set<string>();
  const owners = [...directories].map(([id, directory]) => [id, directory.replaceAll("\\", "/")] as const).sort((a, b) => b[1].length - a[1].length);
  const packages = new Map(descriptor.dependencies.packages.map(item => [item.id, item]));
  const builtins = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`), "bun", "cloudflare:sockets"]);
  const modules: Array<{ owner: string; file: string; key: string; hash: string }> = [];
  const selections: Array<{ owner: string | null; file: string; specifier: string; kind: string; targetOwner: string; targetFile: string }> = [];
  const observed = new Set<string>();
  const failures: string[] = [];
  const result = await Bun.build({
    entrypoints: [...executionHosts, "apps/backend/executionIdentity/launcher.ts", "apps/backend/executionIdentity/resources.ts", ...descriptor.files.map(([path]) => path!).filter(path => path.startsWith("apps/backend/internalModel2/") && path.endsWith(".ts"))],
    target: "bun", env: "disable", packages: "bundle", allowUnresolved: [""],
    plugins: [{ name: "execution-closure", setup(build) {
      build.onLoad({ filter: /.*/ }, args => {
        try {
          const text = lf(readFileSync(args.path, "utf8"));
          const path = relative(root, args.path).replaceAll("\\", "/");
          if (path.startsWith("../")) throw Error(`Execution module outside runtime tree: ${path}`);
          if (!path.split("/").includes("node_modules")) {
            if (inventory.get(path) !== sourceHash(text)) throw Error(`Uninventoried authored execution module: ${path}`);
            authored.add(path);
          }
          const owner = owners.find(([, directory]) => args.path.startsWith(directory + "/"));
          if (path.split("/").includes("node_modules") && !owner) throw Error(`Unpinned installed execution module: ${path}`);
          const key = owner ? `${packages.get(owner[0])!.name}/${relative(owner[1], args.path).replaceAll("\\", "/")}` : args.path;
          if (owner) modules.push({ owner: owner[0], file: relative(owner[1], args.path).replaceAll("\\", "/"), key, hash: sourceHash(text) });
          if (path.endsWith(".json")) return { contents: text, loader: "json" };
          if (!executable.test(path)) throw Error(`Unsupported executable module: ${path}`);
          if (!review || !owner) verifyInstalledModuleLoading(text, args.path, key);
          return { contents: text, loader: loaderFor(args.path) };
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
          throw error;
        }
      });
      build.onResolve({ filter: /.*/ }, args => {
        if (builtins.has(args.path)) return { path: args.path, external: true };
        const resolvePath = () => {
          const path = realpathSync(args.importer ? executionResolve(args.path, args.importer, args.kind) : Bun.resolveSync(resolve(root, args.path), root)).replaceAll("\\", "/");
          if (args.importer) {
            const owner = owners.find(([, directory]) => args.importer.startsWith(directory + "/"));
            const target = owners.find(([, directory]) => path.startsWith(directory + "/"));
            if (target) selections.push({ owner: owner?.[0] ?? null, file: relative(owner?.[1] ?? root, args.importer).replaceAll("\\", "/"), specifier: args.path, kind: args.kind,
              targetOwner: target[0], targetFile: relative(target[1], path).replaceAll("\\", "/") });
          }
          return { path };
        };
        if (!args.importer || args.path.startsWith(".") || isAbsolute(args.path)) return resolvePath();
        const owner = owners.find(([, directory]) => args.importer.startsWith(directory + "/") || args.importer.startsWith(directory + "\\"));
        if (!owner) {
          const importer = relative(root, args.importer).replaceAll("\\", "/");
          const workspace = descriptor.workspaces.some(([, manifest]) => (manifest as { name: string }).name === packageName(args.path));
          if (!workspace && !descriptor.imports.some(item => item.file === importer && item.specifier === args.path)) {
            const message = `Uninventoried authored import: ${importer} -> ${args.path}`;
            failures.push(message);
            throw Error(message);
          }
          return resolvePath();
        }
        const instance = packages.get(owner[0])!, name = packageName(args.path);
        if (name === instance.name) return resolvePath();
        const edge = instance.edges.find(edge => edge.name === name);
        if (!edge) throw Error(`Undeclared installed import: ${instance.id} -> ${args.path}`);
        if (!edge.target || !directories.has(edge.target)) return { path: args.path, external: true };
        const resolved = executionResolve(args.path, args.importer, args.kind);
        const expected = directories.get(edge.target)!;
        if (relative(expected, resolved).startsWith("..")) throw Error(`Installed import resolved outside locked instance: ${instance.id} -> ${args.path}`);
        observed.add(edge.target);
        return resolvePath();
      });
    } }],
  }).catch(error => { throw failures.length ? Error(failures.join("\n")) : error; });
  if (!result.success) throw Error(result.logs.map(log => log.message).join("\n"));
  const contract = { modules: [...new Map(modules.map(module => [module.owner + "/" + module.file, module])).values()].sort((a,b) => a.owner.localeCompare(b.owner) || a.file.localeCompare(b.file)),
    imports: [...new Map(selections.map(selection => [JSON.stringify(selection), selection])).values()].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) };
  if (review) writeFileSync(resolve(root, "apps/backend/executionIdentity/resolutionContract.json"), JSON.stringify(contract, null, 2) + "\n");
  else {
    const expected = JSON.parse(readFileSync(resolve(root, "apps/backend/executionIdentity/resolutionContract.json"), "utf8"));
    if (JSON.stringify(contract) !== JSON.stringify(expected)) throw Error("Selected execution implementations changed; explicit resolution review required");
  }
  return { installedModules: modules.length, modules: result.outputs.length, resolvedPackages: observed.size, authoredModules: authored.size };
}
if (import.meta.main) console.info(JSON.stringify(await checkExecutionResolution(undefined, repositoryRoot, process.argv.includes("--build-contract"))));
