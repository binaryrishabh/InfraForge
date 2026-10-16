import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { contentHash } from "../apps/backend/internalModel2/identity";
import { lessonSource, lessonSourceFiles } from "../apps/backend/tests/integration/lessonSource";
const root = fileURLToPath(new URL("../", import.meta.url)), accepted = "5fd8ee25ac54fbc4d60d74ae3c35aa45c4e476a6";
const originalHash = "19bea478db5f2c158a67765d602d4c129766dc78b32c101ad06c83e54318fce7";
const path = resolve(root, "docs/reality/m2m-m2l-lineage.json"), lf = (s: string) => s.replaceAll("\r\n", "\n");
const folders = ["apps/backend/internalModel2", "apps/web/src/features/internalModel2", "packages/contracts/src/internal-model2"];
const base = ["apps/web/src/api/internalModel2.api.ts", "apps/web/src/app/App.tsx", "apps/web/src/client/httpClient.ts", "apps/web/src/components/shell/AppShell.tsx"];
const watched = (file: string) => base.includes(file) || folders.some((folder) => file.startsWith(folder + "/") && /\.tsx?$/.test(file));
export { lessonSource, lessonSourceFiles };
interface Lineage { schema: string; accepted: string; originalHash: string; original: { file: string; hash: string; text?: string }[]; current: { file: string; hash: string }[]; artifact: string }
function refresh() {
  const original = execFileSync("git", ["ls-tree", "-r", "--name-only", accepted], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(watched).sort().map((file) => {
    const text = lf(execFileSync("git", ["show", `${accepted}:${file}`], { cwd: root, encoding: "utf8", maxBuffer: 4194304 }));
    const current = lf(readFileSync(resolve(root, file), "utf8"));
    return { file, hash: contentHash(text), ...(text !== current ? { text } : {}) };
  });
  const value: Lineage = { schema: "infraforge-m2m-m2l-lineage/1", accepted, originalHash, original,
    current: lessonSourceFiles().map((file) => ({ file, hash: contentHash(lf(readFileSync(resolve(root, file), "utf8"))) })),
    artifact: contentHash(lf(execFileSync("git", ["show", `${accepted}:docs/reality/m2l-browser-proof.json`], { cwd: root, encoding: "utf8", maxBuffer: 4194304 }))) };
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}
export function historicalWorkspaceSource() {
  const value: Lineage = JSON.parse(readFileSync(path, "utf8"));
  if (value.schema !== "infraforge-m2m-m2l-lineage/1" || value.accepted !== accepted || value.originalHash !== originalHash || contentHash(value.current.map((v) => v.file)) !== contentHash(lessonSourceFiles())) throw Error("M2L lineage inventory drift");
  for (const current of value.current) if (contentHash(lf(readFileSync(resolve(root, current.file), "utf8"))) !== current.hash) throw Error(`Reviewed M2M source drift: ${current.file}`);
  if (contentHash(lf(readFileSync(resolve(root, "docs/reality/m2l-browser-proof.json"), "utf8"))) !== value.artifact) throw Error("Accepted M2L evidence changed");
  const files = value.original.map((original) => {
    const text = original.text ?? lf(readFileSync(resolve(root, original.file), "utf8"));
    if (!watched(original.file) || contentHash(text) !== original.hash) throw Error("Original M2L source drift");
    return { file: original.file, text };
  });
  if (contentHash(files) !== originalHash) throw Error("Accepted M2L workspace cannot be reconstructed");
  return contentHash(files);
}
if (import.meta.main) { if (process.argv.includes("--refresh-current")) refresh(); console.info(JSON.stringify({ original: historicalWorkspaceSource(), current: lessonSource() })); }
