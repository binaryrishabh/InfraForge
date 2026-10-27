import { execFileSync } from "node:child_process";
import { expect, test } from "bun:test";
import { checkBackend, checkFrontend, verifyBackend } from "../release/public-check";
import { deploymentSettings } from "../deploy/preflight";
import { nginxConfig } from "../../ops/bootstrap/render";
import { backendReleaseSha, backendState } from "../deploy/backend";
import { mkdtemp, mkdir, readFile, rm, writeFile, unlink, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { admitRelease, requireRun, requireEnvironment } = require("../deploy/gate.cjs");
const { requireFullValidation } = require("../ci/validation.cjs");
const sha = "a".repeat(40);
const repository = "owner/repo";
const run = { id: 1, head_sha: sha, head_branch: "main", event: "push", path: ".github/workflows/validate.yml",
  status: "completed", conclusion: "success", head_repository: { full_name: repository } };
const environment = { can_admins_bypass: false, protection_rules: [{ type: "required_reviewers", reviewers: [{ id: 1 }] }],
  deployment_branch_policy: { custom_branch_policies: true } };
const policies = [{ name: "main", type: "branch" }];
test("backend retry state is read-only and refuses interrupted, maintenance and malformed acceptance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "infraforge-state-test-"));
  const path = join(directory, "accepted.json");
  try {
    expect(await backendState(directory)).toBeUndefined();
    const bytes = JSON.stringify({ current: { sha, authContract: 1, image: "fixture:accepted", imageId: "fixture-id", settingsFingerprint: "fixture-settings" } });
    await writeFile(path, bytes);
    expect((await backendState(directory))?.sha).toBe(sha);
    expect(await readFile(path, "utf8")).toBe(bytes);
    for (const marker of ["release.lock", "maintenance"]) {
      await writeFile(join(directory, marker), "held");
      await expect(backendState(directory)).rejects.toThrow("operator recovery");
      expect(await readFile(join(directory, marker), "utf8")).toBe("held");
      await unlink(join(directory, marker));
      if (process.platform !== "win32") {
        await symlink(join(directory, "missing-target"), join(directory, marker));
        await expect(backendState(directory)).rejects.toThrow("operator recovery");
        await unlink(join(directory, marker));
      }
    }
    for (const bad of ["broken", "null", "{}", JSON.stringify({ current: { sha: "old", authContract: 1 } }), JSON.stringify({ current: { sha, authContract: 2 } })]) {
      await writeFile(path, bad);
      await expect(backendState(directory)).rejects.toThrow();
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("release admission refuses stale, untrusted, failed, incomplete and wrong-workflow CI", () => {
  expect(() => requireRun(run, sha, repository)).not.toThrow();
  for (const change of [{ head_sha: "b".repeat(40) }, { head_branch: "develop" }, { event: "pull_request" },
    { conclusion: "failure" }, { conclusion: "cancelled" }, { status: "in_progress" },
    { head_repository: { full_name: "fork/repo" } }, { path: ".github/workflows/other.yml" }]) {
    expect(() => requireRun({ ...run, ...change }, sha, repository)).toThrow();
  }
});
test("production needs no admin bypass and only the main branch", () => {
  expect(() => requireEnvironment(environment, policies)).not.toThrow();
  expect(() => requireEnvironment({ ...environment, protection_rules: [] }, policies)).not.toThrow();
  for (const change of [{ can_admins_bypass: true }, { deployment_branch_policy: null }]) {
    expect(() => requireEnvironment({ ...environment, ...change }, policies)).toThrow();
  }
  for (const rules of [[], [...policies, { name: "*", type: "tag" }], [{ name: "main", type: "tag" }]]) {
    expect(() => requireEnvironment(environment, rules)).toThrow();
  }
});
test("workflow-run is reread from GitHub; manual retry requires existing successful push CI", async () => {
  const github = { rest: { repos: { getCommit: async () => ({ data: { sha } }), getEnvironment: async () => ({ data: environment }),
    listDeploymentBranchPolicies: async () => ({ data: { branch_policies: policies } }) }, actions: {
    getWorkflowRun: async () => ({ data: run }), listWorkflowRuns: async () => ({ data: { workflow_runs: [run] } }),
  } } };
  const context = { repo: { owner: "owner", repo: "repo" }, eventName: "workflow_run", payload: { workflow_run: { id: 1 } } };
  expect(await admitRelease(github, context)).toBe(sha);
  const manual = { ...context, eventName: "workflow_dispatch", ref: "refs/heads/main" };
  expect(await admitRelease(github, manual, sha)).toBe(sha);
  await expect(admitRelease(github, manual, "b".repeat(40))).rejects.toThrow();
  github.rest.actions.listWorkflowRuns = async () => ({ data: { workflow_runs: [] } });
  await expect(admitRelease(github, manual, sha)).rejects.toThrow("No exact-SHA");
});
test("public identity checks reject maintenance, wrong versions, wrong SHA and mismatched endpoints", () => {
  const health = { success: true, release: { sha, authContract: 1 } };
  expect(() => checkBackend(sha, health, "false")).not.toThrow();
  for (const bad of [null, { success: false }, { ...health, release: { sha: "b".repeat(40), authContract: 1 } },
    { ...health, release: { sha, authContract: 2 } }]) expect(() => checkBackend(sha, bad, "false")).toThrow();
  for (const marker of [null, "true", ""]) expect(() => checkBackend(sha, health, marker)).toThrow();
  const web = { sha, authContract: 1, apiURL: "https://backend.example.invalid/api", wsURL: "wss://backend.example.invalid/ws" };
  expect(() => checkFrontend(sha, "https://backend.example.invalid", web)).not.toThrow();
  for (const bad of [{ sha: "b".repeat(40) }, { authContract: 2 }, { apiURL: "https://other.invalid/api" }, { wsURL: "ws://backend.example.invalid/ws" }]) {
    expect(() => checkFrontend(sha, "https://backend.example.invalid", { ...web, ...bad })).toThrow();
  }
});
test("public backend verifies HTTP responses and credential availability", async () => {
  const original = globalThis.fetch;
  try {
    for (const failure of ["none", "status", "sha", "maintenance", "providers"]) {
      globalThis.fetch = (async (url: string | URL | Request) => new Response(JSON.stringify(String(url).endsWith("/health/ready")
        ? { success: true, release: { sha: failure === "sha" ? "b".repeat(40) : sha, authContract: 1 } }
        : { credentials: failure !== "providers" }), { status: failure === "status" ? 503 : 200,
        headers: { "X-InfraForge-Maintenance": failure === "maintenance" ? "true" : "false" } })) as typeof fetch;
      if (failure === "none") await verifyBackend(sha, "https://backend.example.invalid");
      else await expect(verifyBackend(sha, "https://backend.example.invalid")).rejects.toThrow();
    }
  } finally { globalThis.fetch = original; }
});
test("missing credentials fail before SSH and error messages contain names only", () => {
  const env = { EC2_HOST: "fixture", EC2_USERNAME: "release", EC2_SSH_KEY: "fixture-private-value", EC2_HOST_FINGERPRINT: `SHA256:${"a".repeat(43)}`,
    VERCEL_TOKEN: "fixture-token-value", VERCEL_ORG_ID: "team_fixture", VERCEL_PROJECT_ID: "prj_fixture", RELEASE_SHA: sha,
    BACKEND_ORIGIN: "https://backend.example.invalid", FRONTEND_ORIGIN: "https://app.example.invalid" };
  expect(() => deploymentSettings(env)).not.toThrow();
  for (const key of Object.keys(env)) expect(() => deploymentSettings({ ...env, [key]: "" })).toThrow(key);
  expect(() => deploymentSettings({ ...env, EC2_HOST_FINGERPRINT: "unpinned" })).toThrow("Pinned");
});
test("bootstrap rendering refuses injection and missing TLS inputs while HTTP remains closed", async () => {
  const template = await Bun.file(new URL("../../ops/nginx.conf.template", import.meta.url)).text();
  const http = nginxConfig(template, "backend.example.invalid", "http");
  expect(http).toContain("return 503");
  expect(http).not.toContain("proxy_pass");
  const tls = nginxConfig(template, "backend.example.invalid", "tls", "/etc/letsencrypt/live/backend/fullchain.pem", "/etc/letsencrypt/live/backend/privkey.pem");
  expect(tls).toContain("/var/lib/infraforge/releases/maintenance");
  expect(tls).toContain("127.0.0.1:3000");
  expect(tls).toContain("X-Forwarded-For $remote_addr");
  expect(tls).not.toContain("DOMAIN");
  expect(tls).toContain("limit_req_zone $binary_remote_addr zone=infraforge_health:1m rate=2r/s;");
  expect(tls).toMatch(/location = \/health\/ready \{\s*limit_req zone=infraforge_health burst=4 nodelay;\s*limit_req_status 429;/);
  for (const name of [";include /etc/passwd", "*.example.invalid", "backend.invalid\n}", "-bad.example", "bad..example"]) {
    expect(() => nginxConfig(template, name, "http")).toThrow();
  }
  expect(() => nginxConfig(template, "backend.example.invalid", "tls")).toThrow();
  expect(() => nginxConfig(template, "backend.example.invalid", "tls", "/tmp/../private", "/tmp/key")).toThrow();
});


test("docs-only reuse keeps exact image identity and cannot release an earlier failed code change", async () => {
  const { docsOnlyPaths, docsOnlyChange } = require("../deploy/docs-only.cjs");
  expect(docsOnlyPaths(["docs/guide.txt", "Readme.md", ".agent/notes"])).toBe(true);
  for (const paths of [[], ["docs/guide.md", "apps/backend/index.ts"], ["docs/reality/proof.json"], ["docs/reality/proof.md"], [".github/workflows/validate.yml"], ["bun.lock"]]) {
    expect(docsOnlyPaths(paths)).toBe(false);
  }
  const directory = await mkdtemp(join(tmpdir(), "infraforge-docs-release-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const commit = () => { git("add", "."); git("-c", "user.name=Release fixture", "-c", "user.email=release@example.invalid", "commit", "-qm", "Update fixture"); return git("rev-parse", "HEAD"); };
  try {
    git("init", "-q");
    await writeFile(join(directory, "app.ts"), "original"); const accepted = commit();
    await mkdir(join(directory, "docs"));
    await writeFile(join(directory, "docs", "guide.md"), "guide"); const docs = commit();
    expect(docsOnlyChange(accepted, docs, directory)).toBe(true);
    expect(backendReleaseSha(docs, accepted, directory)).toBe(accepted);
    expect(backendReleaseSha(accepted, accepted, directory)).toBe(accepted);
    expect(docsOnlyChange(docs, accepted, directory)).toBe(false);
    expect(docsOnlyChange("0".repeat(40), docs, directory)).toBe(false);
    expect(docsOnlyChange("--help", docs, directory)).toBe(false);
    await writeFile(join(directory, "app.ts"), 'throw new Error("Code regression");'); const code = commit();
    const validateCode = () => execFileSync(process.execPath, ["--no-env-file", "app.ts"], { cwd: directory, stdio: "pipe" });
    expect(validateCode).toThrow();
    await writeFile(join(directory, "docs", "guide.md"), "another guide"); const laterDocs = commit();
    expect(docsOnlyChange(code, laterDocs, directory)).toBe(true);
    expect(docsOnlyChange(accepted, laterDocs, directory)).toBe(false);
    expect(() => backendReleaseSha(laterDocs, accepted, directory)).toThrow("differs");
    // C only changes prose after failing B, but still contains B's broken code.
    expect(validateCode).toThrow();
    for (const result of ["failure", "skipped"]) {
      const results = { identity: { result: "success" }, ...Object.fromEntries(
        ["checks", "integration", "m2m-preview", "packaging", "operations"].map(job => [job, { result }])) };
      expect(() => requireFullValidation(results)).toThrow();
      expect(() => requireRun({ ...run, head_sha: laterDocs, conclusion: "failure" }, laterDocs, repository)).toThrow();
    }
    // Earlier CI cannot authorize the current docs commit either.
    expect(() => requireRun({ ...run, head_sha: code }, laterDocs, repository)).toThrow();
    git("mv", "app.ts", "docs/moved.md"); const moved = commit();
    expect(docsOnlyChange(laterDocs, moved, directory)).toBe(false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
