import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";
export const analyticsBaseline = "d4e742f5ee5d5e6853449245557e840cf31c2fa0";
export const gitText = (path: string) => execFileSync("git", ["show", `${analyticsBaseline}:${path}`], { encoding: "utf8", maxBuffer: 4194304 }).replaceAll("\r\n", "\n");
export const dependencyContext = ["package.json", "bunfig.toml", "apps/backend/package.json", "apps/web/package.json", ...["catalog", "contracts", "domain", "simulation"].map(p => `packages/${p}/package.json`)];
export function reviewAnalyticsManifest(before: string, after: string) {
  const old = JSON.parse(before), next = JSON.parse(after);
  assert(!old.dependencies["@vercel/analytics"]);
  assert.equal(next.dependencies["@vercel/analytics"], "^2.0.1");
  delete next.dependencies["@vercel/analytics"];
  assert.deepEqual(next, old, "Web manifest extends beyond Analytics");
}
export function reviewAnalyticsLock(before: string, after: string) {
  const parse = (text: string) => { const parsed = ts.parseConfigFileTextToJson("bun.lock", text); assert(!parsed.error, "Invalid lock JSONC"); return parsed.config; };
  const old = parse(before), next = parse(after), packageName = "@vercel/analytics";
  assert(!old.packages[packageName]);
  const analytics = next.packages[packageName];
  assert.equal(analytics?.[0], "@vercel/analytics@2.0.1");
  assert.equal(analytics?.[3], "sha512-MTQG6V9qQrt1tsDeF+2Uoo5aPjqbVPys1xvnIftXSJYG2SrwXRHnqEvVoYID7BTruDz4lCd2Z7rM1BdkUehk2g==");
  assert.deepEqual(Object.keys(analytics[2]).sort(), ["optionalPeers", "peerDependencies"]);
  assert.deepEqual(analytics[2].optionalPeers.slice().sort(), Object.keys(analytics[2].peerDependencies).sort());
  assert.equal(next.workspaces["apps/web"].dependencies[packageName], "^2.0.1");
  delete next.workspaces["apps/web"].dependencies[packageName]; delete next.packages[packageName];
  // Stronger than a projected graph: every pre-existing record, workspace and override is identical.
  assert.deepEqual(next, old, "Change extends beyond the reviewed leaf frontend dependency");
  return { unchangedPackageRecords: Object.keys(old.packages).length, addedPackage: analytics[0],
    before: createHash("sha256").update(before).digest("hex"), after: createHash("sha256").update(after).digest("hex") };
}
if (import.meta.main) console.info(JSON.stringify(reviewAnalyticsLock(gitText("bun.lock"), readFileSync("bun.lock", "utf8").replaceAll("\r\n", "\n"))));
