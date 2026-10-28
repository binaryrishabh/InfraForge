import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

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
