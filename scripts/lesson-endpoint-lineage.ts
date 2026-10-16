import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { contentHash } from "../apps/backend/internalModel2/identity";
import { lessonSource, lessonSourceFiles } from "../apps/backend/tests/integration/lessonSource";
const root = fileURLToPath(new URL("../", import.meta.url)), accepted = "edf0d924cece280e167b0614b99ff8ba9879039f";
const originalHash = "3d4f63b50843968340724844b5c54ab0a02b0c078fa3098d9e1ffee4f9d1a8a1", artifactHash = "b92d05b43aa8cf65edf68a1abb14f4485ab34459281d9070a32d7423b2850cbe";
const path = resolve(root, "docs/reality/lesson-endpoint-m2m-lineage.json"), lf = (s: string) => s.replaceAll("\r\n", "\n");
const folders = ["apps/backend/internalModel2", "apps/web/src/features/internalModel2", "packages/contracts/src/internal-model2", "apps/web/src/features/internalLessons", "packages/contracts/src/internal-lessons"];
const base = lessonSourceFiles().filter((file) => !folders.some((folder) => file.startsWith(folder + "/")));
const watched = (file: string) => base.includes(file) || folders.some((folder) => file.startsWith(folder + "/") && /\.tsx?$/.test(file));
interface Lineage { schema: string; accepted: string; original: { file: string; hash: string; text?: string }[]; current: { file: string; hash: string }[] }
function refresh() {
  const original = execFileSync("git", ["ls-tree", "-r", "--name-only", accepted], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(watched).sort().map((file) => {
    const text = lf(execFileSync("git", ["show", `${accepted}:${file}`], { cwd: root, encoding: "utf8", maxBuffer: 4194304 }));
    return { file, hash: contentHash(text), ...(text !== lf(readFileSync(resolve(root, file), "utf8")) ? { text } : {}) };
  });
  writeFileSync(path, JSON.stringify({ schema: "infraforge-lesson-endpoint-lineage/1", accepted, original,
    current: lessonSourceFiles().map((file) => ({ file, hash: contentHash(lf(readFileSync(resolve(root, file), "utf8"))) })) }, null, 2) + "\n");
}
export function historicalLessonSource(bytes: Uint8Array) {
  if (createHash("sha256").update(bytes).digest("hex") !== artifactHash) throw Error("Original M2M producer bytes changed");
  const value: Lineage = JSON.parse(readFileSync(path, "utf8"));
  if (value.schema !== "infraforge-lesson-endpoint-lineage/1" || value.accepted !== accepted || contentHash(value.current.map((v) => v.file)) !== contentHash(lessonSourceFiles())) throw Error("M2M endpoint lineage inventory drift");
  for (const entry of value.current) if (contentHash(lf(readFileSync(resolve(root, entry.file), "utf8"))) !== entry.hash) throw Error(`Reviewed endpoint source drift: ${entry.file}`);
  const files = value.original.map((entry) => {
    const text = entry.text ?? lf(readFileSync(resolve(root, entry.file), "utf8"));
    if (!watched(entry.file) || contentHash(text) !== entry.hash) throw Error("Original M2M source drift");
    return { file: entry.file, text };
  });
  if (contentHash(files) !== originalHash) throw Error("Original M2M source cannot be reconstructed");
  return contentHash(files);
}
if (import.meta.main) {
  if (process.argv.includes("--refresh-current")) refresh();
  console.info(JSON.stringify({ original: historicalLessonSource(readFileSync(resolve(root, "docs/reality/m2m-preview-proof.json"))), current: lessonSource() }));
}
