import { createRequire, builtinModules } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

// Use the web workspace's declared compiler to parse both value and type imports.
const requireWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
export const ts = requireWeb("typescript");
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));
const sourceExtension = /\.(?:[cm]?[jt]sx?)$/;
const ignoredDirectories = new Set(["node_modules", "dist", "generated", ".git", "Learning"]);
const normalized = (path: string) => path.replaceAll("\\", "/");

export interface ImportEdge {
  source: string;
  specifier: string;
  typeOnly: boolean;
  line: number;
  target?: string;
}

export function imports(source: string, text: string): ImportEdge[] {
  const file = ts.createSourceFile(source, text, ts.ScriptTarget.Latest, true);
  const edges: ImportEdge[] = [];
  const add = (node: any, literal: any, typeOnly: boolean) => {
    if (literal && ts.isStringLiteralLike(literal)) {
      edges.push({ source, specifier: literal.text, typeOnly,
        line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1 });
    }
  };
  const visit = (node: any) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const allTypes = bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0 &&
        bindings.elements.every((element: any) => element.isTypeOnly);
      add(node, node.moduleSpecifier, Boolean(clause?.isTypeOnly || (!clause?.name && allTypes)));
    } else if (ts.isExportDeclaration(node)) {
      const allTypes = node.exportClause && ts.isNamedExports(node.exportClause) &&
        node.exportClause.elements.length > 0 && node.exportClause.elements.every((element: any) => element.isTypeOnly);
      add(node, node.moduleSpecifier, Boolean(node.isTypeOnly || allTypes));
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node, node.argument.literal, true);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      add(node, node.arguments[0], false);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node, node.moduleReference.expression, Boolean(node.isTypeOnly));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return edges;
}

export function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return ignoredDirectories.has(entry.name) || entry.name.startsWith(".") ? [] : sourceFiles(path);
    return sourceExtension.test(entry.name) ? [path] : [];
  });
}

export function cycles(graph: Map<string, string[]>): string[][] {
  const completed = new Set<string>();
  const active: string[] = [];
  const found: string[][] = [];
  const visit = (source: string) => {
    const index = active.indexOf(source);
    if (index !== -1) { found.push([...active.slice(index), source]); return; }
    if (completed.has(source)) return;
    active.push(source);
    for (const target of graph.get(source) ?? []) visit(target);
    active.pop();
    completed.add(source);
  };
  for (const source of graph.keys()) visit(source);
  return found;
}

function owner(file: string): string {
  if (file.startsWith("apps/") || file.startsWith("packages/")) return file.split("/").slice(0, 2).join("/");
  return "root";
}

export function checkBoundaries(root: string): { errors: string[]; edges: ImportEdge[] } {
  const errors: string[] = [];
  for (const folder of ["Frontend", "Backend", "shared"]) {
    if (existsSync(join(root, folder))) errors.push(`Retired root directory remains: ${folder}`);
  }
  const files = ["apps", "packages"].flatMap((folder) => sourceFiles(join(root, folder)));
  const manifests = new Map<string, any>();
  for (const file of files) {
    const area = owner(normalized(relative(root, file)));
    if (!manifests.has(area) && existsSync(join(root, area, "package.json"))) {
      manifests.set(area, JSON.parse(readFileSync(join(root, area, "package.json"), "utf8")));
    }
  }
  const workspaces = new Map<string, { area: string; manifest: any }>();
  for (const [area, manifest] of manifests) workspaces.set(manifest.name, { area, manifest });
  const graph = new Map<string, string[]>();
  const compilerOptions = new Map<string, any>();
  const edges: ImportEdge[] = [];
  for (const file of files) {
    const source = normalized(relative(root, file));
    const area = owner(source);
    const configPath = join(root, area, area === "apps/web" ? "tsconfig.app.json" : "tsconfig.json");
    let options = compilerOptions.get(area);
    if (!options && existsSync(configPath)) {
      const config = ts.readConfigFile(configPath, ts.sys.readFile);
      options = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath)).options;
    }
    options ??= { moduleResolution: ts.ModuleResolutionKind.Bundler };
    compilerOptions.set(area, options);
    const declared = { ...manifests.get(area)?.dependencies, ...manifests.get(area)?.devDependencies,
      ...manifests.get(area)?.peerDependencies };
    for (const edge of imports(source, readFileSync(file, "utf8"))) {
      const specifier = edge.specifier;
      const local = specifier.startsWith(".") || specifier.startsWith("@/");
      const location = `${source}:${edge.line} (${edge.typeOnly ? "type" : "value"})`;
      const dependency = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]!;
      const packageImport = specifier.startsWith("@infraforge/");
      const runtimeOnly = specifier.startsWith("node:") || builtins.has(specifier) || specifier === "bun" || specifier === "bun:test";
      let resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule?.resolvedFileName;
      if (specifier.startsWith("@shared/")) errors.push(`${location}: retired shared alias ${specifier}`);
      if (packageImport) {
        if (dependency !== manifests.get(area)?.name && declared[dependency] !== "workspace:*") {
          errors.push(`${location}: workspace dependency must be declared as workspace:*: ${dependency}`);
        }
        const workspace = workspaces.get(dependency);
        if (!workspace) errors.push(`${location}: unknown workspace ${dependency}`);
        else if (workspace.area.startsWith("apps/")) {
          errors.push(`${location}: app-to-app or package-to-app dependency ${dependency}`);
        } else {
          const subpath = specifier === dependency ? "." : `.${specifier.slice(dependency.length)}`;
          const entry = workspace.manifest.exports?.[subpath];
          const target = typeof entry === "string" ? entry : entry?.types ?? entry?.default;
          if (!target || subpath.includes("*") || !target.startsWith("./") || target.includes("..")) {
            errors.push(`${location}: package subpath is not an explicit export: ${specifier}`);
            resolved = undefined;
          } else {
            resolved = resolve(root, workspace.area, target);
            if (!existsSync(resolved)) errors.push(`${location}: package export target is missing: ${specifier}`);
          }
        }
      } else if (!local && !runtimeOnly && !(dependency in declared)) {
        errors.push(`${location}: undeclared dependency ${dependency}`);
      }
      if (specifier.startsWith("@/") && area !== "apps/web") errors.push(`${location}: web alias used outside its workspace`);
      if (area.startsWith("packages/") && source.includes("/src/") && !local && !packageImport) {
        errors.push(`${location}: pure package source imports an external runtime ${specifier}`);
      }
      if (resolved && !normalized(resolved).includes("/node_modules/")) {
        edge.target = normalized(relative(root, resolved));
        if (area !== owner(edge.target) && !packageImport) errors.push(`${location}: cross-workspace source import: ${edge.target}`);
        graph.set(source, [...(graph.get(source) ?? []), edge.target]);
      } else if (local) {
        const asset = specifier.startsWith("@/") ? join(root, "apps/web/src", specifier.slice(2)) : resolve(dirname(file), specifier);
        if (!existsSync(asset.split("?")[0]!)) errors.push(`${location}: unresolved local import ${specifier}`);
      }
      edges.push(edge);
    }
  }
  for (const cycle of cycles(graph)) errors.push(`File import cycle: ${cycle.join(" -> ")}`);
  // Type imports also form part of the browser contract. Only tuning/capacity are browser-safe simulation exports.
  const reachable = new Set<string>();
  const pending = files.map((file) => normalized(relative(root, file))).filter((file) => file.startsWith("apps/web/src/"));
  while (pending.length) {
    const source = pending.pop()!;
    if (reachable.has(source)) continue;
    reachable.add(source);
    if (/^packages\/simulation\/src\/(?:engine[^/]*|cost|topology|types)(?:\.|\/)/.test(source)) {
      errors.push(`${source}: browser closure reaches forbidden simulation runtime`);
    }
    for (const edge of edges.filter((item) => item.source === source)) {
      if (edge.specifier.startsWith("node:") || builtins.has(edge.specifier) || edge.specifier === "bun" || edge.specifier === "bun:test") {
        errors.push(`${source}:${edge.line}: browser closure imports runtime-only module ${edge.specifier}`);
      }
      if (edge.target) pending.push(edge.target);
    }
  }
  const packageGraph = new Map<string, string[]>();
  for (const manifest of manifests.values()) packageGraph.set(manifest.name,
    Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).filter((name) => name.startsWith("@infraforge/")));
  for (const cycle of cycles(packageGraph)) errors.push(`Workspace dependency cycle: ${cycle.join(" -> ")}`);
  return { errors, edges };
}
