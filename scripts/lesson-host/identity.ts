import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { lessonSource, lessonSourceFiles } from "../../apps/backend/tests/integration/lessonSource";
export function provenance() {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const files = [...lessonSourceFiles(), ...readdirSync(resolve(root, "scripts/lesson-host")).filter((file) => file.endsWith(".ts") || file === "tsconfig.json").map((file) => `scripts/lesson-host/${file}`),
    "apps/backend/tests/integration/lessonOrphanChecks.ts", "apps/backend/tests/integration/localHarness.ts"].sort();
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");
  const sources = files.map((file) => ({ file, sha256: sha(readFileSync(resolve(root, file), "utf8").replaceAll("\r\n", "\n")) }));
  return { proofId: randomUUID(), lessonSource: lessonSource(), verifierSource: sha(JSON.stringify(sources)), sources,
    bun: process.versions.bun, node: process.versions.node };
}
