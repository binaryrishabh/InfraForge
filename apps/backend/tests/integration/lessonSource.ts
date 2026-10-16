import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { contentHash } from "../../internalModel2/identity";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
export function lessonSourceFiles() {
  const files = ["apps/web/src/api/internalModel2.api.ts", "apps/web/src/api/internalLesson.api.ts", "apps/web/src/app/App.tsx", "apps/web/src/client/httpClient.ts", "apps/web/src/components/shell/AppShell.tsx", "apps/backend/worker.ts", "apps/backend/Dockerfile", "apps/backend/release/lessonSchema.ts", "apps/backend/release/migrations.ts", "apps/backend/prisma/schema.prisma", "apps/backend/prisma/migrations/20261020000000_model2_lesson/migration.sql"];
  const walk = (folder: string) => { for (const entry of readdirSync(resolve(root, folder), { withFileTypes: true })) {
    const file = `${folder}/${entry.name}`; if (entry.isDirectory()) walk(file); else if (/\.tsx?$/.test(file)) files.push(file);
  } };
  for (const folder of ["apps/backend/internalModel2", "apps/web/src/features/internalModel2", "packages/contracts/src/internal-model2", "apps/web/src/features/internalLessons", "packages/contracts/src/internal-lessons"]) walk(folder);
  return files.sort();
}
export function lessonSource() { return contentHash(lessonSourceFiles().map((file) => ({ file, text: readFileSync(resolve(root, file), "utf8").replaceAll("\r\n", "\n") }))); }
