import { builtinModules } from "node:module";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import ts from "typescript";
import { sha256, lf } from "../apps/backend/executionIdentity/hash";
import { executionDescriptor, packageName, repositoryRoot } from "../apps/backend/executionIdentity/descriptor";
import { verifyInstalled } from "../apps/backend/executionIdentity/installed";

// Compile without executing application code. Every package import must belong to its locked owner.
export async function checkExecutionResolution() {
  const descriptor = executionDescriptor(), directories = verifyInstalled(descriptor, repositoryRoot);
  const owners = [...directories].map(([id, directory]) => [id, directory.replaceAll("\\", "/")] as const).sort((a, b) => b[1].length - a[1].length);
  const packages = new Map(descriptor.dependencies.packages.map(item => [item.id, item]));
  const builtins = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`), "bun", "cloudflare:sockets"]);
  const observed = new Set<string>();
  const dynamic = new Map([
    ["bullmq/dist/cjs/classes/child-processor.js", "79e70f93580ce61844d91c3a9736925b337d621ae7a404a8d7e350c237258a17"],
    ["express/lib/view.js", "74f4171b66263e22481820bc5975708f7dd8a61484f570aac7c5b4ab77ecbd79"],
  ]);
  const result = await Bun.build({
    entrypoints: descriptor.files.map(([path]) => path!).filter(path => path.startsWith("apps/backend/internalModel2/") && path.endsWith(".ts")),
    target: "bun", env: "disable", packages: "bundle", allowUnresolved: [""],
    plugins: [{ name: "execution-closure", setup(build) {
      build.onLoad({ filter: /\.[cm]?[jt]s$/ }, args => {
        const text = lf(readFileSync(args.path, "utf8")), source = ts.createSourceFile(args.path, text, ts.ScriptTarget.Latest, true);
        let opaque = false;
        function visit(node: ts.Node) {
          if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require" ||
              ts.isPropertyAccessExpression(node.expression) && node.expression.getText(source) === "require.resolve") &&
              (!node.arguments[0] || !ts.isStringLiteralLike(node.arguments[0]))) opaque = true;
          ts.forEachChild(node, visit);
        }
        visit(source);
        if (opaque) {
          const owner = owners.find(([, directory]) => args.path.startsWith(directory + "/"));
          const key = owner ? `${packages.get(owner[0])!.name}/${relative(owner[1], args.path).replaceAll("\\", "/")}` : args.path;
          if (dynamic.get(key) !== sha256(text)) throw Error(`Unreviewed dynamic package loader: ${key}`);
        }
        return { contents: text, loader: args.path.endsWith(".ts") ? "ts" : "js" };
      });
      build.onResolve({ filter: /.*/ }, args => {
        if (builtins.has(args.path)) return { path: args.path, external: true };
        const resolvePath = () => ({ path: realpathSync(Bun.resolveSync(args.importer ? args.path : resolve(repositoryRoot, args.path), args.importer ? dirname(args.importer) : repositoryRoot)).replaceAll("\\", "/") });
        if (!args.importer || args.path.startsWith(".") || isAbsolute(args.path)) return resolvePath();
        const owner = owners.find(([, directory]) => args.importer.startsWith(directory + "/") || args.importer.startsWith(directory + "\\"));
        if (!owner) return resolvePath();
        const instance = packages.get(owner[0])!, name = packageName(args.path);
        if (name === instance.name) return resolvePath();
        const edge = instance.edges.find(edge => edge.name === name);
        if (!edge) throw Error(`Undeclared installed import: ${instance.id} -> ${args.path}`);
        if (!edge.target || !directories.has(edge.target)) return { path: args.path, external: true };
        const resolved = Bun.resolveSync(args.path, dirname(args.importer));
        const expected = directories.get(edge.target)!;
        if (relative(expected, resolved).startsWith("..")) throw Error(`Installed import resolved outside locked instance: ${instance.id} -> ${args.path}`);
        observed.add(edge.target);
        return resolvePath();
      });
    } }],
  });
  if (!result.success) throw Error(result.logs.map(log => log.message).join("\n"));
  return { modules: result.outputs.length, resolvedPackages: observed.size };
}
if (import.meta.main) console.info(JSON.stringify(await checkExecutionResolution()));
