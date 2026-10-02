import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBoundaries, cycles, imports } from "../boundaries";

describe("source import boundaries", () => {
  test("finds aliases, re-exports, dynamic/require and type-only imports", () => {
    const edges = imports("example.ts", `
      import type { A } from '@shared/a';
      import { type B } from './b';
      export type { C } from './c';
      type D = import('./d').D;
      import('./e'); require('./f');
      // import './ignored';
      const example = "import './also-ignored'";
    `);
    expect(edges.map((edge) => [edge.specifier, edge.typeOnly])).toEqual([
      ["@shared/a", true], ["./b", true], ["./c", true], ["./d", true], ["./e", false], ["./f", false],
    ]);
  });

  test("detects import cycles including type-only cycles", () => {
    expect(cycles(new Map([["a", ["b"]], ["b", ["a"]]]))).toEqual([["a", "b", "a"]]);
    expect(cycles(new Map([["a", ["b"]], ["b", []]]))).toEqual([]);
  });

  test("resolves aliases/relative imports and rejects new shared, app, dependency and cycle edges", () => {
    const root = mkdtempSync(join(tmpdir(), "infraforge-boundaries-"));
    const put = (file: string, contents: string) => {
      mkdirSync(join(root, file, ".."), { recursive: true });
      writeFileSync(join(root, file), contents);
    };
    try {
      put("Frontend/package.json", JSON.stringify({ name: "@infraforge/web", dependencies: { declared: "1.0.0" } }));
      put("Backend/package.json", JSON.stringify({ name: "@infraforge/backend" }));
      put("Frontend/tsconfig.app.json", JSON.stringify({ compilerOptions: { moduleResolution: "bundler",
        paths: { "@/*": ["./src/*"], "@shared/*": ["../shared/*"] } } }));
      put("shared/allowed.ts", "export type Allowed = string;");
      put("shared/engine.ts", "export type State = string;");
      put("Backend/host.ts", "export const host = 1;");
      put("Frontend/src/a.ts", "import type { Allowed } from '@shared/allowed'; import './b';");
      put("Frontend/src/b.ts", "export const b = 1;");
      const legacy = { "Frontend/src/a.ts": ["shared/allowed.ts"] };
      expect(checkBoundaries(root, legacy).errors).toEqual([]);
      put("shared/allowed.ts", "import type { State } from './engine'; import 'node:fs'; export type Allowed = string;");
      const closureErrors = checkBoundaries(root, legacy, { "shared/allowed.ts": [] }).errors.join("\n");
      expect(closureErrors).toContain("browser shared closure gains shared/engine.ts");
      expect(closureErrors).toContain("browser shared closure gains node:fs");
      put("shared/allowed.ts", "export type Allowed = string;");
      put("Frontend/src/b.ts", `import type { State } from '../../shared/engine';
        import type { host } from '../../Backend/host'; import 'undeclared'; import '@/a';`);
      const errors = checkBoundaries(root, legacy).errors.join("\n");
      expect(errors).toContain("legacy shared edge is not allowlisted");
      expect(errors).toContain("cross-workspace source import");
      expect(errors).toContain("undeclared dependency undeclared");
      expect(errors).toContain("File import cycle");
    } finally {
      if (!root.startsWith(join(tmpdir(), "infraforge-boundaries-"))) throw new Error("Unexpected temporary fixture path");
      rmSync(root, { recursive: true, force: true });
    }
  });
});
