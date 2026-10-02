import { createRequire, builtinModules } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

// Use the web workspace's declared compiler to parse both value and type imports.
const requireWeb = createRequire(new URL("../Frontend/package.json", import.meta.url));
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
  if (file.startsWith("Frontend/")) return "Frontend";
  if (file.startsWith("Backend/")) return "Backend";
  if (file.startsWith("shared/")) return "shared";
  if (file.startsWith("packages/")) return file.split("/").slice(0, 2).join("/");
  return "root";
}

export function checkBoundaries(root: string, legacy: Record<string, string[]>, browserClosure?: Record<string, string[]>): { errors: string[]; edges: ImportEdge[] } {
  const errors: string[] = [];
  const files = ["Frontend", "Backend", "shared", "packages"].flatMap((folder) => sourceFiles(join(root, folder)));
  const manifests = new Map<string, any>();
  for (const file of files) {
    const area = owner(normalized(relative(root, file)));
    if (!manifests.has(area) && existsSync(join(root, area, "package.json"))) {
      manifests.set(area, JSON.parse(readFileSync(join(root, area, "package.json"), "utf8")));
    }
  }
  const graph = new Map<string, string[]>();
  const compilerOptions = new Map<string, any>();
  const edges: ImportEdge[] = [];
  for (const file of files) {
    const source = normalized(relative(root, file));
    const area = owner(source);
    const configName = area === "Frontend" ? "Frontend/tsconfig.app.json" : `${area}/tsconfig.json`;
    const configPath = join(root, configName);
    let options = compilerOptions.get(area);
    if (!options && existsSync(configPath)) {
      const config = ts.readConfigFile(configPath, ts.sys.readFile);
      options = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath)).options;
    } else if (!options) {
      options = { moduleResolution: ts.ModuleResolutionKind.Bundler,
        paths: { "@shared/*": [join(root, "shared/*")] } };
    }
    compilerOptions.set(area, options);
    const outgoing = imports(source, readFileSync(file, "utf8"));
    for (const edge of outgoing) {
      const specifier = edge.specifier;
      const local = specifier.startsWith(".") || specifier.startsWith("@/") || specifier.startsWith("@shared/");
      const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule?.resolvedFileName;
      const location = `${source}:${edge.line} (${edge.typeOnly ? "type" : "value"})`;
      if (specifier.startsWith("@/") && area !== "Frontend") errors.push(`${location}: web alias used outside its workspace`);
      if (source.startsWith("Frontend/src/") && (specifier.startsWith("node:") || builtins.has(specifier) ||
        specifier === "bun" || specifier === "bun:test")) errors.push(`${location}: browser source imports a runtime-only module ${specifier}`);
      if (resolved && !normalized(resolved).includes("/node_modules/")) {
        edge.target = normalized(relative(root, resolved));
        const targetArea = owner(edge.target);
        if (targetArea === "shared" && area !== "shared") {
          if (!legacy[source]?.includes(edge.target)) errors.push(`${location}: legacy shared edge is not allowlisted: ${edge.target}`);
        } else if (area !== targetArea) {
          errors.push(`${location}: cross-workspace source import: ${edge.target}`);
        }
        if (area === "shared" && targetArea !== "shared") errors.push(`${location}: shared source cannot import ${targetArea}`);
        graph.set(source, [...(graph.get(source) ?? []), edge.target]);
      } else if (local) {
        // Vite owns CSS and image imports; they must still point to real app assets.
        const asset = specifier.startsWith("@/") ? join(root, "Frontend/src", specifier.slice(2)) : resolve(dirname(file), specifier);
        if (!existsSync(asset.split("?")[0]!)) errors.push(`${location}: unresolved local import ${specifier}`);
      } else if (!specifier.startsWith("node:") && !builtins.has(specifier) && specifier !== "bun" && specifier !== "bun:test") {
        const dependency = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]!;
        const manifest = manifests.get(area);
        const declared = { ...manifest?.dependencies, ...manifest?.devDependencies, ...manifest?.peerDependencies };
        if (!(dependency in declared)) errors.push(`${location}: undeclared dependency ${dependency}`);
        if ((area === "Frontend" && dependency === "@infraforge/backend") ||
          (area === "Backend" && dependency === "@infraforge/web")) errors.push(`${location}: app-to-app dependency ${dependency}`);
        if (specifier.startsWith("@infraforge/") && /\/src(?:\/|$)/.test(specifier)) errors.push(`${location}: package source deep import ${specifier}`);
      }
      edges.push(edge);
    }
  }
  for (const cycle of cycles(graph)) errors.push(`File import cycle: ${cycle.join(" -> ")}`);
  if (browserClosure) {
    const reachable = new Set<string>();
    const pending = edges.filter((edge) => edge.source.startsWith("Frontend/src/") && edge.target?.startsWith("shared/"))
      .map((edge) => edge.target!);
    while (pending.length) {
      const source = pending.pop()!;
      if (reachable.has(source)) continue;
      reachable.add(source);
      for (const edge of edges.filter((item) => item.source === source)) {
        const destination = edge.target ?? edge.specifier;
        if (!browserClosure[source]?.includes(destination)) errors.push(`${source}:${edge.line}: browser shared closure gains ${destination}`);
        if (edge.target?.startsWith("shared/")) pending.push(edge.target);
      }
    }
  }
  const packageGraph = new Map<string, string[]>();
  for (const manifest of manifests.values()) packageGraph.set(manifest.name,
    Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).filter((name) => name.startsWith("@infraforge/")));
  for (const cycle of cycles(packageGraph)) errors.push(`Workspace dependency cycle: ${cycle.join(" -> ")}`);
  return { errors, edges };
}
