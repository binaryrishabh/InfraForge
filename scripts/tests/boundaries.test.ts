import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBoundaries, cycles, imports } from "../boundaries";

function withWorkspaceFixture(run: (root: string, put: (file: string, text: string) => void) => void) {
  const root = mkdtempSync(join(tmpdir(), "infraforge-workspaces-"));
  const put = (file: string, text: string) => {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  try {
    for (const [folder, name] of [["apps/web", "web"], ["apps/backend", "backend"]]) {
      put(`${folder}/package.json`, JSON.stringify({ name: `@infraforge/${name}`, dependencies: { "@infraforge/domain": "workspace:*" } }));
    }
    put("packages/domain/package.json", JSON.stringify({ name: "@infraforge/domain", exports: { "./resource": "./src/resource.ts" } }));
    put("packages/domain/src/resource.ts", "export type Resource = string;");
    put("apps/web/src/app.ts", "import type { Resource } from '@infraforge/domain/resource';");
    put("apps/backend/app.ts", "import type { Resource } from '@infraforge/domain/resource';");
    run(root, put);
  } finally {
    if (!root.startsWith(join(tmpdir(), "infraforge-workspaces-"))) throw new Error("Unexpected temporary fixture path");
    rmSync(root, { recursive: true, force: true });
  }
}

describe("source import boundaries", () => {
  test("finds aliases, re-exports, dynamic/require and type-only imports", () => {
    const edges = imports("example.ts", `
      import type { A } from '@/a';
      import { type B } from './b';
      export type { C } from './c';
      type D = import('./d').D;
      import('./e'); require('./f');
      // import './ignored';
      const example = "import './also-ignored'";
    `);
    expect(edges.map((edge) => [edge.specifier, edge.typeOnly])).toEqual([
      ["@/a", true], ["./b", true], ["./c", true], ["./d", true], ["./e", false], ["./f", false],
    ]);
  });

  test("detects cycles including type-only cycles", () => {
    expect(cycles(new Map([["a", ["b"]], ["b", ["a"]]]))).toEqual([["a", "b", "a"]]);
    expect(cycles(new Map([["a", ["b"]], ["b", []]]))).toEqual([]);
  });

  test("accepts explicit exports and rejects undeclared, private and relative package imports", () => {
    withWorkspaceFixture((root, put) => {
      expect(checkBoundaries(root).errors).toEqual([]);
      put("apps/web/package.json", JSON.stringify({ name: "@infraforge/web" }));
      expect(checkBoundaries(root).errors.join("\n")).toContain("workspace dependency must be declared");
      put("apps/web/src/app.ts", "import '@infraforge/domain/src/resource'; import '@infraforge/domain/private'; import '../../../packages/domain/src/resource'; import '../../backend/app';");
      const errors = checkBoundaries(root).errors.join("\n");
      expect(errors).toContain("package subpath is not an explicit export");
      expect(errors).toContain("cross-workspace source import: packages/domain/src/resource.ts");
      expect(errors).toContain("cross-workspace source import: apps/backend/app.ts");
    });
  });

  test("rejects retired aliases and root directories", () => {
    withWorkspaceFixture((root, put) => {
      put("shared/state.ts", "export type State = string;");
      put("apps/web/src/app.ts", "import type { State } from '@shared/state';");
      const errors = checkBoundaries(root).errors.join("\n");
      expect(errors).toContain("Retired root directory remains: shared");
      expect(errors).toContain("retired shared alias");
    });
  });

  test("accepts declared package dependencies and rejects package-to-app imports", () => {
    withWorkspaceFixture((root, put) => {
      put("packages/contracts/package.json", JSON.stringify({ name: "@infraforge/contracts", dependencies: { "@infraforge/domain": "workspace:*" } }));
      put("packages/contracts/src/model.ts", "export type { Resource } from '@infraforge/domain/resource';");
      expect(checkBoundaries(root).errors).toEqual([]);
      put("packages/contracts/src/model.ts", "import '@infraforge/backend';");
      expect(checkBoundaries(root).errors.join("\n")).toContain("app-to-app or package-to-app dependency");
    });
  });

  test("rejects type cycles and transitive runtime imports behind public exports", () => {
    withWorkspaceFixture((root, put) => {
      put("packages/domain/src/resource.ts", "export type { Resource } from './internal';");
      put("packages/domain/src/internal.ts", "import type { Resource } from './resource'; import 'node:fs'; export type Internal = string;");
      const errors = checkBoundaries(root).errors.join("\n");
      expect(errors).toContain("File import cycle");
      expect(errors).toContain("browser closure imports runtime-only module node:fs");
      expect(errors).toContain("pure package source imports an external runtime");
      put("packages/domain/package.json", JSON.stringify({ name: "@infraforge/domain", dependencies: { "@infraforge/web": "workspace:*" }, exports: { "./resource": "./src/resource.ts" } }));
      expect(checkBoundaries(root).errors.join("\n")).toContain("Workspace dependency cycle");
    });
  });

  test("rejects simulation runtime types but accepts browser-safe tuning", () => {
    withWorkspaceFixture((root, put) => {
      put("packages/simulation/package.json", JSON.stringify({ name: "@infraforge/simulation", exports: { "./types": "./src/types/index.ts", "./tuning": "./src/tuning.ts" } }));
      put("packages/simulation/src/types/index.ts", "export type State = string;");
      put("packages/simulation/src/tuning.ts", "export const tuning = 1;");
      put("apps/web/package.json", JSON.stringify({ name: "@infraforge/web", dependencies: { "@infraforge/simulation": "workspace:*" } }));
      put("apps/web/src/app.ts", "import type { State } from '@infraforge/simulation/types';");
      expect(checkBoundaries(root).errors.join("\n")).toContain("browser closure reaches forbidden simulation runtime");
      put("apps/web/src/app.ts", "import { tuning } from '@infraforge/simulation/tuning';");
      expect(checkBoundaries(root).errors).toEqual([]);
    });
  });

  test("resolves web aliases and rejects missing local, dependency and cycle edges", () => {
    withWorkspaceFixture((root, put) => {
      put("apps/web/tsconfig.app.json", JSON.stringify({ compilerOptions: { moduleResolution: "bundler", paths: { "@/*": ["./src/*"] } } }));
      put("apps/web/src/app.ts", "import '@/b';");
      put("apps/web/src/b.ts", "export const b = 1;");
      expect(checkBoundaries(root).errors).toEqual([]);
      put("apps/web/src/b.ts", "import '@/app'; import './missing'; import 'undeclared';");
      const errors = checkBoundaries(root).errors.join("\n");
      expect(errors).toContain("File import cycle");
      expect(errors).toContain("unresolved local import");
      expect(errors).toContain("undeclared dependency");
    });
  });
});
