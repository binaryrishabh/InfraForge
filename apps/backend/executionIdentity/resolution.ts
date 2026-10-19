import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
// The verifier supplies enumerated specifiers only. Match the runtime's distinct
// import/require conditions; resolving everything as an import misses CJS code.
export function executionResolve(specifier: string, importer: string, kind: string) {
  return kind === "require-call" || kind === "require-resolve"
    ? createRequire(resolve(importer)).resolve(specifier)
    : Bun.resolveSync(specifier, dirname(resolve(importer)));
}
