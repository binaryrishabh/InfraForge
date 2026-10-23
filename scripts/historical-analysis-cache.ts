import { digest, sha256 } from "../apps/backend/executionIdentity/hash";

type Imports = ReturnType<Bun.Transpiler["scan"]>["imports"];
let verified: Map<string, Imports> | undefined;
let contentHashes: Map<string, string> | undefined;

// Synchronous, invocation-local memoization. Nothing on disk can populate it.
// Each frozen algorithm still discovers every closure, hashes every source,
// rebuilds every descriptor and checks every whole-lock identity.
export function withHistoricalAnalysisCache<T>(run: () => T): T {
  if (verified) return run();
  verified = new Map();
  contentHashes = new Map();
  try { return run(); } finally { verified = undefined; contentHashes = undefined; }
}

// Keyed by the complete string, never a path or a claimed digest. Retained
// strings are already resident in history.blobs; this adds no duplicate text.
export function historicalContentHash(text: string): string {
  if (!contentHashes) return sha256(text);
  let hash = contentHashes.get(text);
  if (hash === undefined) { hash = sha256(text); contentHashes.set(text, hash); }
  return hash;
}

export function memoHistoricalImports(algorithm: string, path: string, text: string, review: unknown, analyse: () => Imports): Imports {
  if (!verified) return analyse();
  const key = digest([algorithm, path, historicalContentHash(text), review ?? null]);
  const cached = verified.get(key);
  if (cached) return structuredClone(cached);
  const imports = analyse(); // Failures are never cached.
  verified.set(key, structuredClone(imports));
  return imports;
}

// Match the frozen loaders' first matching review, including its alternatives
// and globals. A different review or missing permission must force reanalysis.
export function historicalModuleReview(reviews: Record<string, unknown>, path: string) {
  const normalized = path.replaceAll("\\", "/");
  return Object.entries(reviews).find(([file]) => normalized === file || normalized.endsWith("/" + file))?.[1];
}
