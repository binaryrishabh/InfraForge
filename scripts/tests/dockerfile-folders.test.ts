import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import ignore from "ignore";

// The backend image copies source folders one by one from an allow-listed build context;
// a new folder missing from either file only fails at release time.
test("the backend image copies every backend source folder", () => {
  const dockerfile = readFileSync("apps/backend/Dockerfile", "utf8");
  const allowed = readFileSync(".dockerignore", "utf8").split(/\r?\n/);
  const folders = readdirSync("apps/backend", { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !["node_modules", "tests", "lib", "dist"].includes(entry.name) && !entry.name.startsWith("."))
    .map((entry) => entry.name);
  expect(folders.filter((folder) => !dockerfile.includes(`COPY apps/backend/${folder} ./apps/backend/${folder}/`))).toEqual([]);
  expect(folders.filter((folder) => !allowed.includes(`!apps/backend/${folder}/`))).toEqual([]);
});

test("the build context admits every nested learning source and keeps tooling excluded", () => {
  const context = ignore().add(readFileSync(".dockerignore", "utf8"));
  const files = (folder: string): string[] => readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = `${folder}/${entry.name}`;
    return entry.isDirectory() ? files(path) : [path];
  });
  const authored = files("apps/backend/learning").filter((path) => path.endsWith(".ts") || path.endsWith("README.md"));
  expect(authored.length).toBeGreaterThan(10);
  expect(authored.filter((path) => context.ignores(path))).toEqual([]);
  for (const path of [
    "apps/backend/learning/content/foundations/lessons/.env",
    "apps/backend/learning/content/foundations/lessons/.agent/private.ts",
    "apps/backend/learning/content/foundations/lessons/AGENTS.md",
    "apps/backend/learning/content/foundations/lessons/node_modules/module.ts",
  ]) expect(context.ignores(path)).toBe(true);
});
