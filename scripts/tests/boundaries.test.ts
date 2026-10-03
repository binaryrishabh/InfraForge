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
    for (const [folder, name] of [["Frontend", "web"], ["Backend", "backend"]]) {
      put(`${folder}/package.json`, JSON.stringify({ name: `@infraforge/${name}`, dependencies: { "@infraforge/domain": "workspace:*" } }));
    }
    put("packages/domain/package.json", JSON.stringify({ name: "@infraforge/domain", exports: { "./resource": { types: "./src/resource.ts", default: "./src/resource.ts" } } }));
    put("packages/domain/src/resource.ts", "export type Resource = string;");
    put("Frontend/src/app.ts", "import type { Resource } from '@infraforge/domain/resource';");
    put("Backend/app.ts", "import type { Resource } from '@infraforge/domain/resource';");
    run(root, put);
  } finally {
    if (!root.startsWith(join(tmpdir(), "infraforge-workspaces-"))) throw new Error("Unexpected temporary fixture path");
    rmSync(root, { recursive: true, force: true });
  }
}

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

  test("accepts explicit workspace exports and rejects undeclared, private and relative package imports", () => {
    withWorkspaceFixture((root, put) => {
      expect(checkBoundaries(root, {}).errors).toEqual([]);
      put("Frontend/package.json", JSON.stringify({ name: "@infraforge/web" }));
      expect(checkBoundaries(root, {}).errors.join("\n")).toContain("workspace dependency must be declared");
      put("Frontend/src/app.ts", "import '@infraforge/domain/src/resource'; import '@infraforge/domain/private'; import '../../packages/domain/src/resource'; import '../../Backend/app';");
      const errors = checkBoundaries(root, {}).errors.join("\n");
      expect(errors).toContain("package subpath is not an explicit export");
      expect(errors).toContain("cross-workspace source import: packages/domain/src/resource.ts");
      expect(errors).toContain("cross-workspace source import: Backend/app.ts");
    });
  });

  test("requires exact shared package transitions, their dependency owner and Stage 8 expiry", () => {
    withWorkspaceFixture((root, put) => {
      put("shared/state.ts", "export type { Resource } from '@infraforge/domain/resource';");
      expect(checkBoundaries(root, {}).errors.join("\n")).toContain("legacy package edge is not allowlisted");
      const transition = { expiresAtStage: 8, dependencyOwner: "Backend", imports: { "shared/state.ts": ["@infraforge/domain/resource"] } };
      expect(checkBoundaries(root, {}, undefined, transition).errors).toEqual([]);
      put("Backend/package.json", JSON.stringify({ name: "@infraforge/backend" }));
      expect(checkBoundaries(root, {}, undefined, transition).errors.join("\n")).toContain("workspace dependency must be declared");
      expect(checkBoundaries(root, {}, undefined, { ...transition, expiresAtStage: 9 }).errors.join("\n")).toContain("must expire at Stage 8");
    });
  });

  test("rejects leaf legacy and app imports even when an old shared edge is allowlisted", () => {
    withWorkspaceFixture((root, put) => {
      put("shared/state.ts", "export type State = string;");
      put("packages/domain/src/resource.ts", "import type { State } from '../../../shared/state'; import '@infraforge/backend';");
      const errors = checkBoundaries(root, { "packages/domain/src/resource.ts": ["shared/state.ts"] }).errors.join("\n");
      expect(errors).toContain("leaf package cannot import legacy shared source");
      expect(errors).toContain("app-to-app or package-to-app dependency");
    });
  });

  test("rejects type cycles and transitive browser runtime imports behind public exports", () => {
    withWorkspaceFixture((root, put) => {
      put("packages/domain/src/resource.ts", "export type { Resource } from './internal';");
      put("packages/domain/src/internal.ts", "import type { Resource } from './resource'; import 'node:fs'; export type Internal = string;");
      const errors = checkBoundaries(root, {}).errors.join("\n");
      expect(errors).toContain("File import cycle");
      expect(errors).toContain("browser closure imports runtime-only module node:fs");
      expect(errors).toContain("leaf package source must use package-local imports");
      put("packages/domain/package.json", JSON.stringify({ name: "@infraforge/domain", dependencies: { "@infraforge/web": "workspace:*" }, exports: { "./resource": "./src/resource.ts" } }));
      expect(checkBoundaries(root, {}).errors.join("\n")).toContain("Workspace dependency cycle");
    });
  });

  test("rejects simulation runtime reached through an allowlisted browser shared type", () => {
    withWorkspaceFixture((root, put) => {
      put("Frontend/src/app.ts", "import type { State } from '../../shared/state';");
      put("shared/state.ts", "export type { State } from './simulation/engine';");
      put("shared/simulation/engine.ts", "export type State = string;");
      const errors = checkBoundaries(root, { "Frontend/src/app.ts": ["shared/state.ts"] }).errors.join("\n");
      expect(errors).toContain("browser closure reaches forbidden simulation runtime");
    });
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
