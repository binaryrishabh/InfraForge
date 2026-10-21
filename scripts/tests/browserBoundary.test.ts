import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBoundaries } from "../boundaries";

test("first-stack runtime is isolated to a pure worker closure", () => {
  const prefix = join(tmpdir(), "infraforge-browser-boundaries-"), root = mkdtempSync(prefix);
  const put = (file: string, text: string) => {
    mkdirSync(join(root, file, ".."), { recursive: true }); writeFileSync(join(root, file), text);
  };
  try {
    put("packages/simulation/package.json", JSON.stringify({ name: "@infraforge/simulation", exports: {
      "./internal-first-stack": "./src/internalFirstStack.ts", "./internal-product": "./src/model2/run.ts" } }));
    put("packages/simulation/src/internalFirstStack.ts", "export { run } from './model2/run';");
    put("packages/simulation/src/model2/run.ts", "export const run = 1;");
    put("apps/web/package.json", JSON.stringify({ name: "@infraforge/web", dependencies: { "@infraforge/simulation": "workspace:*" } }));
    put("apps/web/src/app.ts", "export const page = 1;");
    put("apps/web/src/firstStack/worker/entry.ts", "import { run } from '@infraforge/simulation/internal-first-stack';");
    expect(checkBoundaries(root).errors).toEqual([]);
    put("apps/web/src/app.ts", "import './firstStack/worker/entry';");
    expect(checkBoundaries(root).errors.join("\n")).toContain("page imports isolated first-stack worker module");
    expect(checkBoundaries(root).errors.join("\n")).toContain("browser closure reaches forbidden simulation runtime");
    put("apps/web/src/app.ts", "export const page = 1;");
    put("packages/simulation/src/model2/run.ts", "import 'node:fs'; export const run = 1;");
    expect(checkBoundaries(root).errors.join("\n")).toContain("browser worker imports runtime-only module node:fs");
    put("packages/simulation/src/model2/run.ts", "export const run = 1;");
    put("apps/web/src/firstStack/worker/entry.ts", "import { run } from '@infraforge/simulation/internal-product';");
    expect(checkBoundaries(root).errors.join("\n")).toContain("worker must use the first-stack compiler surface");
  } finally {
    if (!root.startsWith(prefix)) throw Error("Unexpected browser boundary fixture path");
    rmSync(root, { recursive: true, force: true });
  }
});
