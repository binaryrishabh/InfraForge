import { memoHistoricalImports, historicalModuleReview } from "./historical-analysis-cache";
// Frozen full syntax analysis for isolation-boundary/1, from main f945fa5.
// Exact snapshot reviews are supplied explicitly. No live files or writable
// persisted analysis cache participates in historical reconstruction.
import { parse } from "acorn";
import { lf, sourceHash } from "../apps/backend/executionIdentity/hash";
interface Review { hash: string; capabilities: string[]; globals?: { hash: string; names: string[] }; alternatives?: Review[] }
export function historicalIsolationLoading(reviews: Record<string, Review>) {
const executable = /\.(?:[cm]?[jt]s|[jt]sx)$/;
function loaderFor(path: string): "ts" | "tsx" | "js" | "jsx" {
  return /\.tsx$/.test(path) ? "tsx" : /\.jsx$/.test(path) ? "jsx" : /\.[cm]?ts$/.test(path) ? "ts" : "js";
}
const transpilers = new Map<string, Bun.Transpiler>();
const emitted = new Map<string, { text: string; code: string }>();
function emittedCode(text: string, path: string) {
  const previous = emitted.get(path);
  if (previous?.text === text) return previous.code;
  const code = sourceScanner(path).transformSync(text);
  emitted.set(path, { text, code });
  return code;
}
function sourceScanner(path: string) {
  const loader = loaderFor(path);
  let scanner = transpilers.get(loader);
  if (!scanner) {
    scanner = new Bun.Transpiler({ loader, target: "bun", treeShaking: false, deadCodeElimination: false,
      tsconfig: JSON.stringify({ compilerOptions: { verbatimModuleSyntax: true } }) });
    transpilers.set(loader, scanner);
  }
  return scanner;
}

interface Syntax { type: string; [key: string]: unknown }
const syntax = (value: unknown): value is Syntax => !!value && typeof value === "object" && "type" in value;
const literal = (node: unknown) => syntax(node) && node.type === "Literal" && typeof node.value === "string";
const identifier = (node: unknown, name: string) => syntax(node) && node.type === "Identifier" && node.name === name;
interface Scope { parent?: Scope; function: boolean; bindings: Set<string> }
function globalReferences(ast: Syntax) {
  const scopes = new Map<Syntax, Scope>();
  const bindings = new Set<Syntax>();
  function bind(pattern: unknown, scope: Scope) {
    if (!syntax(pattern)) return;
    if (pattern.type === "Identifier") { scope.bindings.add(String(pattern.name)); bindings.add(pattern); }
    else if (pattern.type === "RestElement") bind(pattern.argument, scope);
    else if (pattern.type === "AssignmentPattern") bind(pattern.left, scope);
    else if (pattern.type === "ArrayPattern") for (const item of pattern.elements as unknown[]) bind(item, scope);
    else if (pattern.type === "ObjectPattern") for (const item of pattern.properties as Syntax[]) bind(item.type === "RestElement" ? item.argument : item.value, scope);
  }
  function collect(node: Syntax, parent: Scope) {
    if (["FunctionDeclaration", "ClassDeclaration", "ImportDeclaration"].includes(node.type)) {
      bind(node.id, parent);
      for (const item of (node.specifiers ?? []) as Syntax[]) bind(item.local, parent);
    }
    const fn = ["Program", "FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "StaticBlock"].includes(node.type);
    const nested = fn || ["BlockStatement", "CatchClause", "ForStatement", "ForInStatement", "ForOfStatement", "SwitchStatement", "ClassExpression", "ClassDeclaration", "StaticBlock"].includes(node.type);
    const scope = nested ? { parent, function: fn, bindings: new Set<string>() } : parent;
    scopes.set(node, scope);
    if (fn) { bind(node.id, scope); for (const param of (node.params ?? []) as Syntax[]) bind(param, scope); }
    if (["FunctionDeclaration", "FunctionExpression"].includes(node.type)) scope.bindings.add("arguments");
    if (["ClassExpression", "ClassDeclaration"].includes(node.type)) bind(node.id, scope);
    if (node.type === "CatchClause") bind(node.param, scope);
    if (node.type === "VariableDeclaration") {
      let owner = scope;
      if (node.kind === "var") while (!owner.function && owner.parent) owner = owner.parent;
      for (const item of node.declarations as Syntax[]) bind(item.id, owner);
    }
    for (const [key, value] of Object.entries(node)) {
      // Body vars are not visible to parameter initializers. A switch's lexical
      // declarations likewise cannot bind its discriminant in the outer scope.
      const childScope = fn && key === "body" && syntax(value) && value.type === "BlockStatement" ? { parent: scope, function: true, bindings: new Set<string>() } : node.type === "SwitchStatement" && key === "discriminant" ? parent : scope;
      if (syntax(value)) collect(value, childScope);
      else if (Array.isArray(value)) for (const child of value) if (syntax(child)) collect(child, scope);
    }
  }
  collect(ast, { function: true, bindings: new Set() });
  return (node: unknown, name: string) => {
    if (!identifier(node, name) || bindings.has(node as Syntax)) return false;
    for (let scope = scopes.get(node as Syntax); scope; scope = scope.parent) if (scope.bindings.has(name)) return false;
    return true;
  };
}
function identifierReference(node: Syntax, parent?: Syntax, grandparent?: Syntax) {
  if (node.type !== "Identifier") return false;
  if (parent?.type === "MemberExpression" && parent.property === node && !parent.computed) return false;
  if (["Property", "MethodDefinition", "PropertyDefinition"].includes(parent?.type ?? "") && parent?.key === node && !parent.computed && !parent.shorthand) return false;
  if (["ImportSpecifier", "ImportDefaultSpecifier", "ImportNamespaceSpecifier", "MetaProperty"].includes(parent?.type ?? "")) return false;
  if (parent?.type === "ExportSpecifier" && (parent.exported === node || grandparent?.source)) return false;
  if (["LabeledStatement", "BreakStatement", "ContinueStatement"].includes(parent?.type ?? "") && parent?.label === node) return false;
  return true;
}

// Reviewed free globals used by the authored execution closure. Host objects and
// unknown names are capabilities, never inferred from a list of global aliases.
const executionGlobals = new Set([
  "AbortController", "Array", "BigInt", "Boolean", "Buffer", "Date", "Error",
  "JSON", "Map", "Math", "NaN", "Number", "Object", "Promise", "Set", "String",
  "Symbol", "URL", "WeakMap", "clearInterval", "clearTimeout", "console",
  "parseInt", "setInterval", "setTimeout", "structuredClone", "undefined",
]);
const checked = new Map<string, { text: string; requests: ReturnType<Bun.Transpiler["scan"]>["imports"] }>();
const scans = new Map<string, { text: string; imports: ReturnType<Bun.Transpiler["scan"]>["imports"] }>();
const codeHosts = new Set(["vm", "node:vm", "worker_threads", "node:worker_threads", "inspector", "node:inspector", "inspector/promises", "node:inspector/promises", "repl", "node:repl", "child_process", "node:child_process"]);
function executionImports(text: string, path: string) {
  const previous = scans.get(path);
  if (previous?.text === text) return previous.imports;
  const requests = verifyModuleLoading(text, path);
  const scanner = sourceScanner(path);
  const imports = [...scanner.scan(text).imports, ...scanner.scan(emittedCode(text, path)).imports, ...requests]
    .filter((entry, index, all) => all.findIndex(other => other.path === entry.path && other.kind === entry.kind) === index);
  scans.set(path, { text, imports });
  return imports;
}

// Only literal imports and direct require calls are enumerable. Loader values cannot escape.
function verifyModuleLoading(text: string, path: string) {
  text = lf(text);
  const previousAnalysis = checked.get(path);
  if (previousAnalysis?.text === text) return previousAnalysis.requests;
  const normalized = path.replaceAll("\\", "/");
  const review = Object.entries(reviews as Record<string, Review>).find(([file]) => normalized === file || normalized.endsWith("/" + file))?.[1];
  const exact = review && [review, ...(review.alternatives ?? [])].find(candidate => candidate.hash === sourceHash(text));
  if (exact?.capabilities.some(capability => ["generated-client", "trusted-resolver", "trusted-fixture"].includes(capability))) {
    const requests = [...sourceScanner(path).scan(text).imports];
    const ast = parse(emittedCode(text, path), { ecmaVersion: "latest", sourceType: "module" });
    const visit = (node: Syntax) => {
      if (node.type === "ImportExpression") {
        if (!literal(node.source)) throw Error(`Unreviewed generated import: ${path}`);
        requests.push({ path: String((node.source as Syntax).value), kind: "dynamic-import" });
      }
      for (const value of Object.values(node)) {
        if (syntax(value)) visit(value);
        else if (Array.isArray(value)) for (const child of value) if (syntax(child)) visit(child);
      }
    };
    visit(ast as unknown as Syntax);
    return requests;
  }
  const literals: ReturnType<Bun.Transpiler["scan"]>["imports"] = [];
  const code = emittedCode(text, path);
  const ast = parse(code, { ecmaVersion: "latest", sourceType: "module", allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true });
  const global = globalReferences(ast as unknown as Syntax);
  // Authored exceptions are frozen adapters, not path-wide permissions.
  const processAdapter = normalized.endsWith("apps/backend/internalModel2/dockerConnection.ts") && sourceHash(text) === "614e7e40f425cfd19edc0c8d789e9b0cf622e291d9f110d4026c3ca0911cff02" ||
    normalized.endsWith("apps/backend/firstStack/isolationConnection.ts") && sourceHash(text) === "13c2a168cc178a4ad53080716564545add86f9e95e081884f414d3b51d6b774c";
  const errorAdapter = normalized.endsWith("apps/backend/utils/errors.ts") && sourceHash(text) === "bb936198f6a1a31a0c5b70cfd945e7922f69438e0888af6ec0c2fa54350b89fa";
  const permissions = exact?.capabilities ?? [];
  const reviewedGlobals = review?.globals?.hash === sourceHash(text) ? review.globals.names : [];
  const computedReview = permissions.includes("computed-data");
  const resourceReview = permissions.includes("resources");
  const verifierReview = permissions.includes("verifier");
  const forbiddenHost = (name: string) => codeHosts.has(name) && !(processAdapter && ["child_process", "node:child_process"].includes(name));
  function reject() { throw Error(`Unreviewed dynamic execution loader: ${path}`); }
  function resourceHost(name: string) { return ["fs", "node:fs", "fs/promises", "node:fs/promises", "node:sqlite", "sqlite", "bun:sqlite", "node:wasi", "wasi"].includes(name); }
  function visit(node: Syntax, parent?: Syntax, grandparent?: Syntax) {
    if (identifierReference(node, parent, grandparent) && global(node, String(node.name)) && !executionGlobals.has(String(node.name)) && !reviewedGlobals.includes(String(node.name))) reject();
    if (["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type) && literal(node.source)) literals.push({ path: String((node.source as Syntax).value), kind: "import-statement" });
    if (["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type) && syntax(node.source) && ["module", "node:module"].includes(String(node.source.value))) {
      const specifiers = node.specifiers as Syntax[];
      if (node.type !== "ImportDeclaration" || !specifiers.length || specifiers.some(item => item.type !== "ImportSpecifier" || !identifier(item.imported, "builtinModules"))) reject();
    }
    if (["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type) && syntax(node.source) && ["bun", "process", "node:process"].includes(String(node.source.value))) reject();
    if (["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration", "ImportExpression"].includes(node.type) && syntax(node.source) && forbiddenHost(String(node.source.value))) reject();
    if (node.type === "ImportExpression" && (!literal(node.source) || ["module", "node:module", "bun", "process", "node:process"].includes(String((node.source as Syntax).value)))) reject();
    if (node.type === "ImportExpression" && literal(node.source)) literals.push({ path: String((node.source as Syntax).value), kind: "dynamic-import" });
    const propertyName = parent?.type === "MemberExpression" && parent.property === node && !parent.computed || parent?.type === "Property" && parent.key === node && !parent.computed && !parent.shorthand;
    const presence = parent?.type === "BinaryExpression" && parent.operator === "in" && parent.right === node;
    if (!propertyName && (node.type === "Identifier" && ["createRequire", "_load", "eval", "Function"].includes(String(node.name)) || global(node, "Worker"))) reject();
    if (node.type === "Property" && parent?.type === "ObjectPattern" && (node.computed && !literal(node.key) || identifier(node.key, "constructor") || syntax(node.key) && node.key.value === "constructor")) reject();
    if (!resourceReview && !verifierReview && ["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration", "ImportExpression"].includes(node.type) && syntax(node.source) && resourceHost(String(node.source.value))) reject();
    if (!resourceReview && !verifierReview && ["WebAssembly", "fetch", "XMLHttpRequest", "EventSource"].some(name => global(node, name))) reject();
    if (node.type === "MetaProperty" && identifier(node.meta, "import") && !(parent?.type === "MemberExpression" && parent.object === node && !parent.computed && ["url", "dir", "path", "file", "main"].some(name => identifier(parent!.property, name)))) reject();
    if (node.type === "MemberExpression") {
      if (!verifierReview && ["globalThis", "global"].some(name => global(node.object, name))) reject();
      const property = node.property as Syntax;
      const name = node.computed ? property.value : property.name;
      // Unknown keys can extract Function from any object through its prototype.
      // No spelling shortcut: parse every module, including innocent-looking aliases.
      const fixedSymbol = syntax(node.property) && node.property.type === "MemberExpression" && global(node.property.object, "Symbol") && !node.property.computed && ["iterator", "asyncIterator", "toStringTag"].some(name => identifier((node.property as Syntax).property, name));
      const primitiveKey = property.type === "Literal" && ["string", "number"].includes(typeof property.value);
      if (node.computed && !primitiveKey && !fixedSymbol && !computedReview && !verifierReview) reject();
      if (global(node.object, "Bun") && !["version", "sleep", "nanoseconds"].includes(String(name)) && !verifierReview) reject();
      if (["caller", "callee", "arguments"].includes(String(name)) && !computedReview && !verifierReview) reject();
      if (["require", "createRequire", "_load", "getBuiltinModule", "mainModule", "binding", "_linkedBinding", "dlopen"].includes(String(name))) reject();
      if (name === "constructor" && !errorAdapter) reject();
      if (!verifierReview && (global(node.object, "Reflect") || global(node.object, "Object") && ["getOwnPropertyDescriptor", "getOwnPropertyDescriptors", "getPrototypeOf", "setPrototypeOf"].includes(String(name)))) reject();
      if (["__proto__", "__lookupGetter__", "__lookupSetter__", "__defineGetter__", "__defineSetter__"].includes(String(name))) reject();
      if (["globalThis", "global"].some(name => global(node.object, name)) && ["eval", "Function", "process", "Bun", "global", "globalThis", "module"].includes(String(name))) reject();
      if (global(node.object, "module") && !["exports", "filename", "id"].includes(String(name))) reject();
      if (global(node.object, "Bun") && ["plugin", "dlopen", "spawn", "spawnSync"].includes(String(name))) reject();
      if (["globalThis", "global", "process", "Bun"].some(name => global(node.object, name)) && node.computed && !literal(property)) reject();
    }
    if (!propertyName && !errorAdapter && ["Error", "EvalError", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "AggregateError"].some(name => global(node, name))) {
      const construct = ["CallExpression", "NewExpression"].includes(parent?.type ?? "") && parent?.callee === node;
      const check = parent?.type === "BinaryExpression" && parent.operator === "instanceof" && parent.right === node;
      const inherit = ["ClassDeclaration", "ClassExpression"].includes(parent?.type ?? "") && parent?.superClass === node;
      if (!construct && !check && !inherit && !(parent?.type === "UnaryExpression" && parent.operator === "typeof")) reject();
    }
    if (identifier(node, "require")) {
      const direct = parent?.type === "CallExpression" && parent.callee === node && (parent.arguments as Syntax[]).length === 1 && literal((parent.arguments as Syntax[])[0]);
      const resolve = parent?.type === "MemberExpression" && parent.object === node && !parent.computed && identifier(parent.property, "resolve") && grandparent?.type === "CallExpression" && grandparent.callee === parent && (grandparent.arguments as Syntax[]).length === 1 && literal((grandparent.arguments as Syntax[])[0]);
      const typeOf = parent?.type === "UnaryExpression" && parent.operator === "typeof";
      if (!direct && !resolve && !typeOf) reject();
      if (direct && !resourceReview && !verifierReview && resourceHost(String(((parent!.arguments as Syntax[])[0]!).value))) reject();
      if (direct && (["module", "node:module", "bun", "process", "node:process"].includes(String(((parent!.arguments as Syntax[])[0]!).value)) || forbiddenHost(String(((parent!.arguments as Syntax[])[0]!).value)))) reject();
      if (resolve) literals.push({ path: String(((grandparent!.arguments as Syntax[])[0]!).value), kind: "require-resolve" });
      if (direct) literals.push({ path: String(((parent!.arguments as Syntax[])[0]!).value), kind: "require-call" });
    }
    if (!propertyName && global(node, "Symbol") && !(parent?.type === "MemberExpression" && parent.object === node) && !(parent?.type === "CallExpression" && parent.callee === node) && !(parent?.type === "UnaryExpression" && parent.operator === "typeof")) reject();
    if (!propertyName && !presence && ["Object", "Reflect"].some(name => global(node, name)) && !(parent?.type === "MemberExpression" && parent.object === node)) reject();
    if (!propertyName && !presence && ["module", "globalThis", "global", "process", "Bun"].some(name => global(node, name)) && !(parent?.type === "MemberExpression" && parent.object === node) && !(parent?.type === "UnaryExpression" && parent.operator === "typeof")) reject();
    if (node.type === "CallExpression" && syntax(node.callee) && node.callee.type === "MemberExpression" && identifier(node.callee.object, "require")) {
      if ((node.arguments as Syntax[]).length !== 1 || !literal((node.arguments as Syntax[])[0])) reject();
    }
    for (const value of Object.values(node)) {
      if (syntax(value)) visit(value, node, parent);
      else if (Array.isArray(value)) for (const child of value) if (syntax(child)) visit(child, node, parent);
    }
  }
  visit(ast as unknown as Syntax);
  checked.set(path, { text, requests: literals });
  return literals;
}


return { executable, executionImports: (text: string, path: string) => memoHistoricalImports("isolation-boundary/1", path, text, historicalModuleReview(reviews, path), () => executionImports(text, path)) };
}
