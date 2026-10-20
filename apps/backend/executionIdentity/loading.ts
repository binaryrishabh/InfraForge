import { parse } from "acorn";
import { readFileSync } from "node:fs";
import { lf, sourceHash, digest } from "./hash";
import reviews from "./capabilityReviews.json";
import selected from "./resolutionContract.json";

export const executable = /\.(?:[cm]?[jt]s|[jt]sx)$/;
export function loaderFor(path: string): "ts" | "tsx" | "js" | "jsx" {
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
export function sourceScanner(path: string) {
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
type Requests = ReturnType<Bun.Transpiler["scan"]>["imports"];
export interface AnalysisContract { schema: string; policy: string; modules: Record<string, { hash: string; requests: Requests }> }
// This pin is an explicit review of the generated analysis, never a writable
// runtime cache. Core verifier files are always analysed and cannot pin themselves.
const analysisPin = "ab2b3dbf60479b46980aa033b10281b7937f946154d42c83c9c8964f3f72b940";
let fullAnalysis = false, approvedAnalysis: AnalysisContract | undefined;
export function withFullLoadingAnalysis<T>(run: () => T): T {
  const previous = fullAnalysis; fullAnalysis = true;
  try { return run(); } finally { fullAnalysis = previous; }
}
export function loadingPolicyFingerprint() {
  const source = lf(readFileSync(new URL(import.meta.url), "utf8"));
  if (source.split(analysisPin).length !== 2) throw Error("Ambiguous loading analysis pin");
  // Core review hashes depend on this pin; they are excluded from this key and
  // their source always takes the full analysis path. Other permissions are bound.
  return digest({ source: source.replace(analysisPin, ""), runtime: Bun.version, selected,
    reviews: Object.fromEntries(Object.entries(reviews).filter(([path]) => !path.startsWith("apps/backend/executionIdentity/"))) });
}
export function validateLoadingAnalysis(source: string, policy = loadingPolicyFingerprint()) {
  const text = lf(source);
  if (sourceHash(text) !== analysisPin) throw Error("Loading analysis bytes changed; rebuild the reviewed contract");
  const contract = JSON.parse(text) as AnalysisContract;
  if (contract.schema !== "execution-loading-analysis/1" || contract.policy !== policy) throw Error("Loading analysis policy changed; rebuild the reviewed contract");
  return contract;
}
export function readLoadingAnalysis() {
  return validateLoadingAnalysis(readFileSync(new URL("./analysisContract.json", import.meta.url), "utf8"));
}
const codeHosts = new Set(["vm", "node:vm", "worker_threads", "node:worker_threads", "inspector", "node:inspector", "inspector/promises", "node:inspector/promises", "repl", "node:repl", "child_process", "node:child_process"]);
interface Review { hash: string; capabilities: string[]; globals?: { hash: string; names: string[] }; alternatives?: Review[] }
export function executionImports(text: string, path: string) {
  const previous = scans.get(path);
  if (!fullAnalysis && previous?.text === text) return previous.imports;
  const requests = verifyModuleLoading(text, path);
  const scanner = sourceScanner(path);
  const imports = [...scanner.scan(text).imports, ...scanner.scan(emittedCode(text, path)).imports, ...requests]
    .filter((entry, index, all) => all.findIndex(other => other.path === entry.path && other.kind === entry.kind) === index);
  scans.set(path, { text, imports });
  return imports;
}

// Only literal imports and direct require calls are enumerable. Loader values cannot escape.
export function verifyModuleLoading(text: string, path: string) {
  text = lf(text);
  const previousAnalysis = checked.get(path);
  if (!fullAnalysis && previousAnalysis?.text === text) return previousAnalysis.requests;
  const normalized = path.replaceAll("\\", "/");
  if (!fullAnalysis) {
    approvedAnalysis ??= readLoadingAnalysis();
    const approved = Object.entries(approvedAnalysis.modules).find(([file]) => normalized === file || normalized.endsWith("/" + file))?.[1];
    if (approved?.hash === sourceHash(text)) return approved.requests;
  }
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
  const processAdapter = normalized.endsWith("apps/backend/internalModel2/dockerConnection.ts") && sourceHash(text) === "614e7e40f425cfd19edc0c8d789e9b0cf622e291d9f110d4026c3ca0911cff02";
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

export function verifyInstalledModuleLoading(text: string, path: string, key: string) {
  const pinned = (selected.modules as Array<{ key: string; hash: string }>).some(module => module.key === key && module.hash === sourceHash(text));
  // Reviewed selected implementation bytes, never a package/path-wide exception.
  if (pinned) return;
  try { verifyModuleLoading(text, path); } catch (error) {
    if (reviewedLoaders.get(key) !== sourceHash(text)) throw Error(`Unreviewed dynamic package loader: ${key}`, { cause: error });
  }
}

// Exact installed files reviewed for enumerable adapters, wrappers, or local bindings.
const reviewedLoaders = new Map<string, string>([
  // Descriptor copying, fixed class mixins, and Redis-client forwarding.
  ["merge-descriptors/index.js", "ab8b36ec38b7c0e870e702af942c3f694c9915dbdb63e4d1b1cb774df8ba9d74"],
  ["bullmq/dist/cjs/classes/ioredis-client.js", "27a4712a43a03764bcec07697bac85306691dc9d557412b61ca0509cb1f79102"],
  ["http-errors/index.js", "33bda88afcd1a83566eb4ebb305f852b701e19aad5e1d92cb3a11161d35c50f0"],
  ["cron-parser/dist/index.js", "71cc2bfedca63581688961f8b8b8b4a15cbe6aeab426d342c1477bf1de86b040"],
  ["cron-parser/dist/fields/index.js", "c59d0fb093e6b0c55166aabb539159267d8632748c4e0479b375f6a23c9858a0"],
  ["ioredis/built/utils/applyMixin.js", "3b4f5d1d9f4d30d0cdbef98b06c508e7229338638c3f4ba9bdf00d00a9eeed38"],
  ["ioredis/built/utils/lodash.js", "fdd24f9bacb0a27a6bc791bd86e15278ccdc4098e352efc1bee18d5fa6be3882"],
  ["gopd/gOPD.js", "48a04dcb3fb5cccb6c8541a3a8227b8d9f881ea3ffef3177ac4bb0338556b839"],
  ["has-symbols/shams.js", "41277ab2db4a31094dc6f4ca2c3cbbe5576da5e5bddac4bda6c1f0d9c0e0c417"],
  // Class factories/metadata, fixed native probes, and BullMQ's unused process adapter.
  ["zod/v4/classic/schemas.js", "eb4af7946a092aff8678b9251728ea58dab40154920cd65ec4a2ca1d4df68393"],
  ["zod/v4/core/schemas.js", "09da9b0cb9b9d2d795c349bc47c7521d5aaffe241885f0c9728f2aa7de3834c9"],
  ["bullmq/dist/cjs/classes/child.js", "407af2a58068191f9b7ee1648c6c3a81e353623c120cc17fc228235b61709383"],
  ["bullmq/dist/cjs/classes/bun-redis-client.js", "afaaaae77c080d1d1d04bcc087dc69369694bd67b63e3f5a5e1f3181d4a8366f"],
  ["bullmq/dist/cjs/classes/valkey-glide-client.js", "5e0dc9cbf77307c98d549aca8463104f461304f5a849b7495cab67ec35a9fa68"],
  ["bullmq/dist/cjs/classes/errors/delayed-error.js", "a3a4c42e1850ae05b7afdcf2208fd48b6603554f1b3c60e49b3de990fe8c81eb"],
  ["bullmq/dist/cjs/classes/errors/rate-limit-error.js", "deffc90a55e957224625e619abe0741601792cf399e1904d3ce7394fccd11dfc"],
  ["bullmq/dist/cjs/classes/errors/unrecoverable-error.js", "12defe0519676c9a168cd42464c6506adb10ecb3bad6ff7b5a0a63165337dcd1"],
  ["bullmq/dist/cjs/classes/errors/waiting-children-error.js", "0d10909e4779d5b1e3c928adf4770bd799a987de4aaff16a4713375dc37f5549"],
  ["bullmq/dist/cjs/classes/errors/waiting-error.js", "c8bbd41e5ab283bcbedbc8cff09604a666ed9dae9fdd61f8d4550a988a540591"],
  ["ioredis/built/Pipeline.js", "1ea84626153740c5d9161f93cf85581d8df943b0465701a8d1571d722671b6e8"],
  ["ioredis/built/errors/ClusterAllFailedError.js", "83038381acf7161590ecd6041f6dbba2206ee8b6913e3f4fdca80ea3473e3be9"],
  ["ioredis/built/errors/MaxRetriesPerRequestError.js", "bc9858d568d1fed5a7f046809ed528b8af9e94bdefd413f563021d87db46caab"],
  ["redis-errors/lib/old.js", "9b99bc38b3f9ea61c93cacd367a39bd5c067492378c896a6418232b4e4fc96c8"],
  ["redis-errors/lib/modern.js", "1259a58d3b393e96dce399b99375ada36179e448ea4e2fee097b0645c097ff8d"],
  ["msgpackr/pack.js", "450a306d0eef45a95689701939c992e8651fdda0d70045f8cb3c2ff8ff9b1599"],
  ["inherits/inherits_browser.js", "ad322a7b1dec60f3d2ebda2091816469efb55b567d241cf3cf0fa4c5a4afe500"],
  ["cron-parser/dist/fields/CronDayOfWeek.js", "ab0a1254051e1aa1ba2d5dd8330209db652c2c4fa82097d74a345ce2861ae7bb"],
  ["cron-parser/dist/fields/CronField.js", "06ab91635638ac6284a3fbdf5646001ae7832c5765487a74fc393cd8c2154307"],
  ["safer-buffer/safer.js", "37f9716144105051ab302f6a0c30a52ff5de7269b9e1173ac22be798fc11ccad"],
  ["qs/lib/utils.js", "d1d1d5c915493d399388b8ea340a412e87c8421514c6a0d5b45dc07fcebe86ef"],
  ["detect-libc/lib/detect-libc.js", "5de6a1c1abec8bba5ea1261cf819d83a73c92ebe72b879ae48c59ca12320a462"],
  ["tslib/tslib.js", "5b1e566051b18c117f2c8554197163ce9307a69d841dccd39e315e1c173cb21c"],
  ["zod/v4/core/core.js", "a5e713beaac4647151e03716a83f51ab714e5337cf66850f3b28eaf072a0bbfe"],
  ["zod/v4/core/registries.js", "620ea1a715ccc4e6e605a271343bf47942dccae90885dc71f137b1f08a972e50"],
  ["ioredis/built/tracing.js", "0fcd762da79611f969f8b781c731bdf34bfdf8ca73cd2f4ba97e23ba15a9fa10"],
  ["node-gyp-build-optional-packages/node-gyp-build.js", "21145626bbb3122baf79f196087f05d6f1eeb7b9c65c037ced6940c5c6113440"],
  ["msgpackr/unpack.js", "f7ecc666d2e1cb45f9523cc9e865bedfb87bdf4f9661ac93acadcedcc65ebb76"],
  ["node-gyp-build-optional-packages/index.js", "a7ed0d5ae218a19bdbdf15a590d0893790ddf536313b66a787554693cfaae078"],
  ["hasown/index.js", "8f875520f41a3d711566013882af290c840969316cc72cd6b35f7e81d7dfc6d2"],
  ["function-bind/implementation.js", "5c52eb40601e0716dafff9759cf28d8d4af3e2fc2e2c96384f43dbfd0f7370b5"],
  ["zod/v4/core/util.js", "968e3433e810cf7ba5efb609a1cb6d9a6cfb51215fd1f699938228f7ac25deb3"],
  ["zod/v4/core/doc.js", "e084bbcc536746a8942fd33b08afe4db345554b3a0383114f1dca95261c958d9"],
  ["once/once.js", "3db73e347ecbdbafdf8d0db85145c877e133f5372e767360ef90c09f70ac5103"],
  ["depd/index.js", "4d587a5662e20a7bb9bfe6555afe5987e1b80303a819b447394f37a93297ee91"],
  ["msgpackr/node-index.js", "e6217b2b310e751aff02243feb2d318828121fa4d393ac45691aed8d55bc2b49"],
  ["ipaddr.js/lib/ipaddr.js", "d82a21a6872925dfe73e9aa10e9eb47baba398987560e36db107f44d92f069b0"],
  ["iconv-lite/lib/helpers/merge-exports.js", "040baa601833402217e617a104dd32beb27615645f6c16924596ae2d9a58e1dc"],
  ["object-inspect/index.js", "9aad508be54fbe29d82145d54352e7a19c01e19b70e1202b0123449fe9afcde6"],
  ["get-intrinsic/index.js", "c3bc7278af37cede0da2db32724fa0b89a07c44205c44c4f5db0e4d8d497d49c"],
  ["function-bind/index.js", "12fa1b92429db25599f6fe118cbbb877f7f62b83cb9bfe2fc896b2d6a8110647"],
  ["call-bind-apply-helpers/functionCall.js", "22d50c812748973250e9aa1994882a880c6e3bfc90d45e41f609cab97beee3fe"],
  ["call-bind-apply-helpers/functionApply.js", "6170e997fbe03c6f8ff48946ada7d54c7aadc01531509af81f0edfdb7be00e27"],
  ["bullmq/dist/cjs/classes/child-processor.js", "79e70f93580ce61844d91c3a9736925b337d621ae7a404a8d7e350c237258a17"],
  ["express/lib/view.js", "74f4171b66263e22481820bc5975708f7dd8a61484f570aac7c5b4ab77ecbd79"],
]);
