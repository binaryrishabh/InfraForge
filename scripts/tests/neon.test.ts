import { expect, test } from "bun:test";
import { rehearsalTarget, productionIdentity, rehearsalWorkspace, rehearsalRetirementRequest,
  rehearsalPasswordFile, REHEARSAL_CREDENTIAL_ACK, type NeonMetadata } from "../release/neon";
import { databaseUrl } from "../../apps/backend/cutover/database";
import { FENCE_ACK, retirementRequest } from "../../apps/backend/cutover/retire";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const production = { projectId: "fixture-project", branchId: "br-production" };
const url = "postgresql://fixture:fixture-password@ep-fixture.us-east-2.aws.neon.tech/neondb?sslmode=verify-full";
const env = { REHEARSAL_PROJECT_ID: production.projectId, REHEARSAL_BRANCH_ID: "br-rehearsal",
  REHEARSAL_ID: "infraforge-rehearsal-0123456789abcdef", REHEARSAL_DISPOSABLE: "disposable-neon-branch",
  REHEARSAL_CREDENTIAL_ACK, REHEARSAL_ISOLATION_EVIDENCE: "fixture-branch-password-reset",
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

test("Neon password routing prefixes are refused after URL decoding without secret diagnostics", () => {
  for (const password of ["endpoint=ep-other;fixture-secret", "endpoint=ep-other$fixture-secret",
    "project=ep-other;fixture-secret", "PROJECT=ep-other$fixture-secret", "endpoint=", "endpoint=ep-other"]) {
    for (const credential of [password, encodeURIComponent(password)]) {
      const routed = url.replace("fixture-password", credential);
      for (const key of ["DATABASE_URL", "MIGRATION_DATABASE_URL", "WORKER_DATABASE_URL"]) {
        let error: unknown;
        try { rehearsalTarget({ ...env, [key]: routed }, production, metadata); } catch (failure) { error = failure; }
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("routing directives");
        expect((error as Error).message).not.toContain(credential);
        expect((error as Error).message).not.toContain("fixture-secret");
        expect((error as Error).message).not.toContain("ep-other");
      }
    }
  }
  // Generic PostgreSQL validation deliberately has no Neon password policy.
  expect(() => databaseUrl("postgresql://fixture:endpoint=local;secret@localhost/fixture")).not.toThrow();
});

test("ordinary passwords and harmless partial routing text preserve hostname identity", () => {
  for (const password of ["fixture-Strong7!$;:+%\\", "my-endpoint=ep-fixture;strong", "endpoint-not-a-directive$strong", "endpoint", "projected=strong"]) {
    const ordinary = url.replace("fixture-password", encodeURIComponent(password));
    expect(rehearsalTarget({ ...env, DATABASE_URL: ordinary, MIGRATION_DATABASE_URL: ordinary, WORKER_DATABASE_URL: ordinary }, production, metadata).database).toBe("neondb");
  }
  for (const query of ["options=endpoint%3Dep-other", "host=production.invalid", "sslmode=disable", "dbname=other"]) {
    expect(() => rehearsalTarget({ ...env, DATABASE_URL: url + "&" + query }, production, metadata)).toThrow();
  }
});

test("rehearsal credential acknowledgement and production writer acknowledgement cannot substitute for each other", () => {
  const ids = [crypto.randomUUID()];
  expect(rehearsalRetirementRequest(ids, env)).toEqual({ ids, evidence: env.REHEARSAL_ISOLATION_EVIDENCE });
  for (const acknowledgement of [undefined, FENCE_ACK, "disposable-neon-branch"]) {
    const invalid = { ...env, REHEARSAL_CREDENTIAL_ACK: acknowledgement, REHEARSAL_FENCE_ACK: FENCE_ACK };
    expect(() => rehearsalRetirementRequest(ids, invalid)).toThrow("rehearsal-only");
    expect(() => rehearsalTarget(invalid, production, metadata)).toThrow("rehearsal-only");
  }
  expect(() => retirementRequest(ids, REHEARSAL_CREDENTIAL_ACK, "fixture")).toThrow("fenced");
  expect(() => rehearsalRetirementRequest(ids, { ...env, REHEARSAL_ISOLATION_EVIDENCE: undefined })).toThrow("evidence");
});

test("dump password files escape libpq separators and refuse injected lines", () => {
  const password = "strong:password\\value";
  expect(rehearsalPasswordFile(url.replace("fixture-password", encodeURIComponent(password))))
    .toBe("ep-fixture.us-east-2.aws.neon.tech:5432:neondb:fixture:strong\\:password\\\\value\n");
  for (const credential of ["bad\nentry", "bad\rentry", "bad\0entry"]) {
    expect(() => rehearsalPasswordFile(url.replace("fixture-password", encodeURIComponent(credential)))).toThrow("field");
  }
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
