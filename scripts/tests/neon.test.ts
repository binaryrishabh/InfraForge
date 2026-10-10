import { expect, test } from "bun:test";
import { rehearsalTarget, productionIdentity, rehearsalWorkspace, type NeonMetadata } from "../release/neon";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const production = { projectId: "fixture-project", branchId: "br-production" };
const url = "postgresql://fixture:fixture-password@ep-fixture.us-east-2.aws.neon.tech/neondb?sslmode=verify-full";
const env = { REHEARSAL_PROJECT_ID: production.projectId, REHEARSAL_BRANCH_ID: "br-rehearsal",
  REHEARSAL_ID: "infraforge-rehearsal-0123456789abcdef", REHEARSAL_DISPOSABLE: "disposable-neon-branch",
  DATABASE_URL: url, MIGRATION_DATABASE_URL: url, WORKER_DATABASE_URL: url };
const metadata: NeonMetadata = {
  branch: { id: "br-rehearsal", project_id: production.projectId, parent_id: production.branchId, name: env.REHEARSAL_ID, default: false, protected: false, current_state: "ready" },
  production: { id: production.branchId, project_id: production.projectId, name: "production", default: true, protected: true, current_state: "ready" },
  endpoints: [{ id: "ep-fixture", project_id: production.projectId, branch_id: "br-rehearsal", host: "ep-fixture.us-east-2.aws.neon.tech", type: "read_write", disabled: false }],
};
test("Neon rehearsal proves each endpoint belongs to a disposable child and redacts its display", () => {
  const result = rehearsalTarget(env, production, metadata);
  expect(result.database).toBe("neondb");
  expect(JSON.stringify(result.display)).not.toContain("ep-fixture");
  expect(JSON.stringify(result.display)).not.toContain("fixture-password");
});

test("independent production identity cannot be loaded from inside the checkout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "infraforge-identity-test-"));
  const root = join(directory, "checkout");
  await mkdir(root);
  try {
    const outside = join(directory, "production.json");
    const inside = join(root, "..private.json");
    await writeFile(outside, JSON.stringify(production)); await writeFile(inside, JSON.stringify(production));
    expect(await productionIdentity(outside, root)).toEqual(production);
    await expect(productionIdentity(inside, root)).rejects.toThrow("outside");
    await expect(productionIdentity("relative.json", root)).rejects.toThrow("absolute");
  } finally {
    if (!resolve(directory).startsWith(resolve(tmpdir(), "infraforge-identity-test-"))) throw new Error("Unexpected temporary directory");
    await rm(directory, { recursive: true });
  }
});
test("same production branch, wrong parent, default/protected branch and unknown endpoint fail closed", () => {
  for (const change of [{ REHEARSAL_BRANCH_ID: production.branchId }, { REHEARSAL_DISPOSABLE: undefined },
    { REHEARSAL_BRANCH_ID: undefined }, { REHEARSAL_PROJECT_ID: undefined },
    { REHEARSAL_ID: "production" }, { WORKER_DATABASE_URL: url.replace("ep-fixture.", "ep-fixture-pooler.") },
    { DATABASE_URL: url + "&host=production.invalid" }, { DATABASE_URL: url.replace("ep-fixture", "ep-unknown") }]) {
    expect(() => rehearsalTarget({ ...env, ...change }, production, metadata)).toThrow();
  }
  for (const change of [{ parent_id: "br-other" }, { default: true }, { protected: true }, { current_state: "init" }]) {
    expect(() => rehearsalTarget(env, production, { ...metadata, branch: { ...metadata.branch, ...change } })).toThrow();
  }
  expect(() => rehearsalTarget(env, production, { ...metadata, endpoints: [{ ...metadata.endpoints[0]!, branch_id: production.branchId }] })).toThrow();
  expect(() => rehearsalTarget(env, production, { ...metadata, endpoints: [...metadata.endpoints, ...metadata.endpoints] })).toThrow();
});

test("external rehearsal rejects production Compose/state paths and missing independent identity", async () => {
  const state = join(tmpdir(), "infraforge-neon-rehearsal-fixture");
  expect(() => rehearsalWorkspace("infraforge_rehearsal_0123abcd", state)).not.toThrow();
  for (const [project, directory] of [["infraforge", state], ["infraforge_rehearsal_0123abcd", "/var/lib/infraforge/releases"],
    ["infraforge_rehearsal_0123abcd", join(tmpdir(), "accepted.json")], ["infraforge_rehearsal_0123abcd", "relative"]]) {
    expect(() => rehearsalWorkspace(project!, directory!)).toThrow("production");
  }
  await expect(productionIdentity(undefined, state)).rejects.toThrow("independent");
});
