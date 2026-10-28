import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

// The backend image copies source folders one by one; a new folder missing here only fails at release time.
test("the backend image copies every backend source folder", () => {
  const dockerfile = readFileSync("apps/backend/Dockerfile", "utf8");
  const folders = readdirSync("apps/backend", { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !["node_modules", "tests", "lib", "dist"].includes(entry.name) && !entry.name.startsWith("."))
    .map((entry) => entry.name);
  expect(folders.filter((folder) => !dockerfile.includes(`COPY apps/backend/${folder} ./apps/backend/${folder}/`))).toEqual([]);
});
