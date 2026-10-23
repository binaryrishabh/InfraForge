import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { sourceHash } from "../apps/backend/executionIdentity/hash";

// Exact-source capability review precedes refresh-execution.ts. No verifier or
// loader-policy changes, path-wide permissions, or runtime proof relabeling.
if (!process.argv.includes("--write")) throw Error("Use --write after reviewing account service capabilities");
const baseline = "fd8253b26850b870465f15632cd82ea96eb441a7";
execFileSync("git", ["merge-base", "--is-ancestor", baseline, "main"]);
const read = (path: string) => readFileSync(path, "utf8").replaceAll("\r\n", "\n");
const original = (path: string) => execFileSync("git", ["show", `${baseline}:${path}`], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).replaceAll("\r\n", "\n");
const acceptance = "scripts/tests/execution-identity.test.ts";
const beforeTest = original(acceptance);
const expectedTest = beforeTest.replace("expect(table.entries.length).toBe(55);", `expect(table.entries.length).toBe(56);\n  expect(table.entries.some((row: { commit: string }) => row.commit === "${baseline}")).toBe(true);`);
if (read(acceptance) !== expectedTest || expectedTest === beforeTest) throw Error("Account review permits only the new retained-main transition assertion");
for (const path of ["apps/backend/executionIdentity/descriptor.ts", "scripts/execution-identity.ts", "scripts/refresh-execution.ts",
  "apps/backend/executionIdentity/capabilities.ts", "apps/backend/executionIdentity/transitions.ts", "package.json"]) {
  if (read(path) !== original(path)) throw Error(`Outside account review: ${path}`);
}
// Declare the already-installed pinned core package for its public after-commit
// API. No package resolution/version change or transitive dependency addition.
for (const path of ["apps/backend/package.json", "bun.lock"]) {
  const indent = path === "bun.lock" ? "        " : "    ";
  const line = `${indent}"@better-auth/prisma-adapter": "1.7.7",`;
  const expected = original(path).replace(line, `${indent}"@better-auth/core": "1.7.7",\n${line}`);
  if (read(path) !== expected || expected === original(path)) throw Error(`Outside pinned after-commit dependency review: ${path}`);
}
const loading = "apps/backend/executionIdentity/loading.ts";
const stripPin = (value: string) => value.replace(/const analysisPin = "[a-f0-9]{64}";/, 'const analysisPin = "generated";');
if (stripPin(read(loading)) !== stripPin(original(loading))) throw Error("Loader policy changes are outside account review");
const reviewPath = "apps/backend/executionIdentity/capabilityReviews.json", reviews = JSON.parse(read(reviewPath));
const auth = ["accountData", "accountPolicy", "accountRoutes", "auth", "createAuth", "credentials", "email", "httpSecurity", "origin", "settings", "turnstile", "verification"].map(n => `apps/backend/auth/${n}.ts`);
const modules = [...auth, "apps/backend/index.ts", "apps/backend/release/accountSchema.ts", "apps/backend/release/migrations.ts"];
const resources = new Set(["apps/backend/auth/email.ts", "apps/backend/auth/turnstile.ts", "apps/backend/release/accountSchema.ts"]);
const globals: Record<string, string[]> = {
  "apps/backend/auth/email.ts": ["AbortSignal", "fetch"],
  "apps/backend/auth/turnstile.ts": ["AbortSignal", "URLSearchParams", "fetch"],
  "apps/backend/auth/accountPolicy.ts": ["Headers", "Request", "Response"],
};
for (const path of modules) {
  const old = reviews[path], hash = sourceHash(read(path));
  const capabilities = [...new Set([...(old?.capabilities ?? []), ...(resources.has(path) ? ["resources"] : []),
    ...(path.endsWith("/email.ts") ? ["computed-data"] : [])])];
  const names = [...new Set([...(old?.globals?.names ?? []), ...(globals[path] ?? [])])];
  reviews[path] = { ...old, hash, capabilities, ...(names.length ? { globals: { hash, names } } : {}),
    review: "Exact account-service review: fixed SES/Resend/Turnstile HTTPS adapters; bounded email delivery after native transaction commit; atomic single-statement verification ledger; native Better Auth tokens/passwords; keyed quotas; owner-filtered export and serialized profile deletion. No evaluators, dynamic imports, new process adapters, engine changes or activation." };
}
// Only fresh pinned Prisma 7.9.1 outputs receive generated-client review.
const generatedFiles: string[] = [];
function generated(folder: string) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = `${folder}/${entry.name}`;
    if (entry.isDirectory()) generated(path);
    else if (path.endsWith(".ts")) {
      generatedFiles.push(path);
      reviews[path] = { hash: sourceHash(read(path)), capabilities: ["generated-client"],
        review: "Prisma 7.9.1 output for additive account tombstone and hash-only verification redemption schema; pinned generator/dependencies; fixed literal imports and no authored runtime injected" };
    }
  }
}
generated("apps/backend/lib/generated/prisma");
writeFileSync(reviewPath, JSON.stringify(reviews, null, 2) + "\n");
// Preserve every historical source row. Only the stronger shared acceptance
// assertion receives a fresh hash in receipts that pin that test.
for (const path of ["docs/reality/finite-io-source-review.json", "docs/reality/first-stack-report-source-review.json",
  "docs/reality/first-stack-source-review.json", "docs/reality/postgres-session-source-review.json", "docs/reality/scored-challenges-source-review.json"]) {
  const before = JSON.parse(original(path)), expected = structuredClone(before);
  for (const row of [...expected.files, ...(expected.acceptance ?? [])]) {
    if (row.path === acceptance) row["sha256" in row ? "sha256" : "hash"] = sourceHash(read(acceptance));
    else if (read(row.path) !== original(row.path)) throw Error(`Historical source changed: ${row.path}`);
  }
  if (![before, expected].some(value => JSON.stringify(value) === JSON.stringify(JSON.parse(read(path))))) throw Error("Unrelated historical review change");
  writeFileSync(path, JSON.stringify(expected, null, 2) + "\n");
}
writeFileSync("docs/reality/account-essentials-source-review.json", JSON.stringify({ schema: "account-essentials-source-review/1", baseline,
  scope: "Disabled-by-default account recovery/export/profile deletion; independent optional signup challenge; no engine behavior change or Model 2 activation",
  files: [...modules, "apps/backend/package.json", "bun.lock", "apps/backend/prisma/schema.prisma", "apps/backend/prisma/migrations/20261023000000_account_essentials/migration.sql", ...generatedFiles]
    .map(path => ({ path, hash: sourceHash(read(path)) })),
  acceptance: [acceptance, "apps/backend/tests/accountEssentials.test.ts", "apps/backend/tests/integration/accountEssentials.integration.test.ts"]
    .map(path => ({ path, hash: sourceHash(read(path)) })),
}, null, 2) + "\n");
console.info(`Reviewed ${modules.length} account modules and ${generatedFiles.length} generated Prisma files`);
