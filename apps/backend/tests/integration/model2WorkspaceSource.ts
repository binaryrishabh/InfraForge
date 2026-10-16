import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { contentHash } from "../../internalModel2/identity";

// Keep browser/authoring proof lineage separate from immutable execution lineage.
const root = fileURLToPath(new URL("../../../../", import.meta.url));
export function workspaceSource() {
  const files = ["apps/web/src/api/internalModel2.api.ts", "apps/web/src/app/App.tsx", "apps/web/src/client/httpClient.ts", "apps/web/src/components/shell/AppShell.tsx"];
  const walk = (folder: string) => { for (const entry of readdirSync(resolve(root, folder), { withFileTypes: true })) {
    const path = `${folder}/${entry.name}`;
    if (entry.isDirectory()) walk(path); else if (/\.tsx?$/.test(entry.name)) files.push(path);
  } };
  for (const folder of ["apps/backend/internalModel2", "apps/web/src/features/internalModel2", "packages/contracts/src/internal-model2"]) walk(folder);
  files.push("apps/backend/internalModel2/legacyRuntime.json");
  return contentHash(files.sort().map((file) => ({ file: relative(root, resolve(root, file)).replaceAll("\\", "/"), text: readFileSync(resolve(root, file), "utf8").replaceAll("\r\n", "\n") })));
}
