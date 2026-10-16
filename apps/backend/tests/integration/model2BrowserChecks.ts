import { expect } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { LocalHarness, until } from "./localHarness";
import { SessionFixtures } from "./sessionFixtures";
import { captureBarrier, alterRecordedField } from "./model2Barriers";
import { contentHash } from "../../internalModel2/identity";
import { educationalExample } from "@infraforge/contracts/internal-model2/example";
import { workspaceSource } from "./model2WorkspaceSource";

export async function checkModel2Browser(h: LocalHarness, sessions: SessionFixtures, designs: string[]) {
  if (!process.env.MODEL2_BROWSER_MODULE) return { executed: false, reason: "Pinned Playwright runtime is supplied by CI" };
  const { chromium } = await import(process.env.MODEL2_BROWSER_MODULE);
  const browser = await chromium.launch({ headless: true });
  const output = join(tmpdir(), "infraforge-m2l"); await mkdir(output, { recursive: true });
  const proof: Record<string, any> = { schema: "infraforge-m2l-browser/1", commit: process.env.GITHUB_SHA, source: workspaceSource(), browser: browser.version(), startedAt: new Date().toISOString(), success: false, cases: [] };
  const cookie = h.cookie, alice = await sessions.create(), bob = await sessions.create(), rows: string[] = [];
  const server = Bun.spawn([process.execPath, "--no-env-file", "--no-install", "../../node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], {
    cwd: fileURLToPath(new URL("../../../web/", import.meta.url)),
    env: { PATH: process.env.PATH, VITE_BACKEND_API_URL: h.api, DO_NOT_TRACK: "1" }, stdout: "ignore", stderr: "ignore" });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const addSession = async (ctx: any, value: string) => { const at = value.indexOf("="); await ctx.addCookies([{ name: value.slice(0, at), value: value.slice(at + 1), url: h.api, sameSite: "Lax" }]); };
  await addSession(context, alice.cookie);
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const read = async (id: string) => (await h.sql.query('SELECT * FROM "InternalModel2Run" WHERE id=$1', [id])).rows[0];
  const retain = async (id: string) => { const row = await read(id); return { id, input: row.input, capture: row.evidence, status: row.status, reason: row.reason, sequence: row.sequence, throughUs: row.throughUs,
    report: (await h.request(`/internal/model2/runs/${id}/report`)).report, replay: row.evidence ? (await h.request(`/internal/model2/runs/${id}/replay`)).replay : null }; };
  const execute = async () => {
    await page.getByRole("button", { name: "Validate and review on server" }).click();
    await page.getByRole("heading", { name: "Review the exact execution" }).waitFor();
    await page.getByLabel("I reviewed this saved revision", { exact: false }).focus(); await page.keyboard.press("Space");
    await page.getByRole("button", { name: "Execute reviewed Model-2 run" }).press("Enter");
    await page.waitForURL(/\?run=/); const id = new URL(page.url()).searchParams.get("run")!; rows.push(id); return id;
  };
  try {
    await h.stop("worker"); h.cookie = alice.cookie;
    await until(async () => { try { return (await fetch(h.origin)).ok || undefined; } catch { return undefined; } }, "real Vite browser workspace");
    await page.goto(h.origin + "/internal/model2");
    await page.getByText("Internal workspace unavailable for this session", { exact: false }).waitFor();
    expect(await page.getByRole("link", { name: "Model 2 · internal" }).count()).toBe(0);
    await h.sql.query('INSERT INTO "InternalModel2Grant" ("userId",reason) VALUES ($1,\'Disposable M2L browser proof\'),($2,\'Disposable second browser\')', [alice.user.id, bob.user.id]);
    const layout = { resources: [{ id: "app", type: "Virtual Machine", x: 0, y: 0 }, { id: "objects", type: "Object Storage", x: 200, y: 0 }], connectionLines: [{ id: "data", sourceId: "app", targetId: "objects", sourceType: "Virtual Machine", targetType: "Object Storage", port: 8080 }] };
    const save = async (name: string, data: unknown) => { const result = (await h.request("/infrastructure", { name, layout: data }, "POST", 201)).createdInfrastructure; designs.push(result.id); return result; };
    const saved = await save("Browser authored design", layout);
    const unsupported = await save("Legacy field refusal", { ...layout, resources: [{ ...layout.resources[0], public: false }, layout.resources[1]] });
    const validation = { infrastructureId: saved.id, expectedDesignUpdatedAt: saved.updatedAt, idempotencyKey: "browser-preflight", authoring: educationalExample() };
    const before = (await h.sql.query('SELECT count(*)::int AS n FROM "InternalModel2Run"')).rows[0].n;
    const reviewed = await h.request("/internal/model2/validate", validation, "POST");
    expect(reviewed.review.requestHash).toBe(contentHash(reviewed.review.request));
    expect((await h.sql.query('SELECT count(*)::int AS n FROM "InternalModel2Run"')).rows[0].n).toBe(before);
    await h.request("/internal/model2/validate", { ...validation, expectedDesignUpdatedAt: "2020-01-01T00:00:00.000Z" }, "POST", 409);
    const badPort = structuredClone(validation); badPort.authoring.values.port = "9090";
    expect((await h.request("/internal/model2/validate", badPort, "POST", 422)).diagnostics.length).toBeGreaterThan(0);
    expect((await fetch(h.api + "/internal/model2/validate", { method: "POST", headers: { Origin: h.origin, "Content-Type": "application/json" }, body: JSON.stringify(validation) })).status).toBe(401);
    h.cookie = bob.cookie; await h.request("/internal/model2/validate", validation, "POST", 404); h.cookie = alice.cookie;
    proof.cases.push("read-only server validation", "stale saved revision", "authoritative compiler refusal", "validation authorization and owner isolation");
    await page.reload(); await page.getByLabel("Saved infrastructure design").selectOption(unsupported.id);
    await page.getByText("public is outside the internal scope", { exact: false }).waitFor();
    expect(await page.getByRole("button", { name: "Validate and review on server" }).isDisabled()).toBe(true);
    await page.getByLabel("Saved infrastructure design").selectOption(saved.id);
    await page.getByText("Need an explicit authored starting point?").click();
    await page.getByRole("button", { name: "Load authored educational example" }).click();
    await page.getByLabel("Read CPU demand (cpu-us)", { exact: true }).fill("");
    await page.getByRole("button", { name: "Validate and review on server" }).click();
    await page.getByText("Server validation refused this input", { exact: false }).waitFor();
    expect(await page.getByLabel("Read CPU demand (cpu-us)", { exact: true }).getAttribute("aria-invalid")).toBe("true");
    await page.getByLabel("Read CPU demand (cpu-us)", { exact: true }).fill("30");
    await page.getByRole("button", { name: "Validate and review on server" }).click();
    await page.getByRole("heading", { name: "Review the exact execution" }).waitFor();
    await page.getByRole("button", { name: "Back to edit" }).click();
    expect(await page.getByLabel("Read CPU demand (cpu-us)", { exact: true }).inputValue()).toBe("30");
    for (const name of ["Refresh saved revisions", "Refresh internal history"]) {
      const response = page.waitForResponse((r: any) => r.url().endsWith("/internal/model2/runs") && r.request().method() === "GET");
      await page.getByRole("button", { name, exact: true }).click(); await response;
    }
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
    await page.screenshot({ path: join(output, "authoring-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    proof.cases.push("review editing and saved/history refresh", "mobile authoring");
    // Commit through the real API, then lose only the response. Retry must retain identity.
    let lost = false;
    await page.route("**/api/internal/model2/runs", async (route: any) => {
      if (route.request().method() === "POST" && !lost) { lost = true; await route.fetch(); await route.abort("failed"); } else await route.continue();
    });
    await page.getByRole("button", { name: "Validate and review on server" }).click();
    await page.getByRole("heading", { name: "Review the exact execution" }).waitFor();
    const reviewedIdentity = (await page.getByText("Reviewed request identity:", { exact: false }).textContent())?.split(": ")[1];
    await page.screenshot({ path: join(output, "review-desktop.png"), fullPage: true });
    await page.getByLabel("I reviewed this saved revision", { exact: false }).check();
    await page.getByRole("button", { name: "Execute reviewed Model-2 run" }).click();
    await page.getByRole("button", { name: "Retry exact submission" }).waitFor();
    await until(async () => (await h.sql.query('SELECT 1 FROM "InternalModel2Run" WHERE "ownerId"=$1', [alice.user.id])).rowCount === 1 || undefined, "one durable response-lost admission");
    await page.reload(); await page.getByRole("button", { name: "Retry exact submission" }).click({ clickCount: 2 });
    await page.waitForURL(/\?run=/); const queued = new URL(page.url()).searchParams.get("run")!; rows.push(queued);
    expect((await read(queued)).requestHash).toBe(reviewedIdentity);
    expect((await h.sql.query('SELECT 1 FROM "InternalModel2Run" WHERE "ownerId"=$1', [alice.user.id])).rowCount).toBe(1);
    await page.getByRole("button", { name: "Cancel this run" }).click();
    await page.getByText("Status: cancelled", { exact: false }).waitFor();
    proof.queued = await retain(queued);
    proof.cases.push("grant refusal", "unsupported saved design", "server field errors", "keyboard review", "lost response + refresh + duplicate click", "queued GUI cancellation");
    await page.goto(h.origin + "/internal/model2");
    const completeId = await execute(); await h.startWorker();
    await until(async () => (await read(completeId)).status === "completed" || undefined, "browser-admitted real worker completion", 30000);
    await page.getByRole("button", { name: "Refresh durable report" }).click();
    await page.getByText("Status: completed", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Verify deterministic replay" }).click();
    await page.getByText("Replay: MatchesRecordedPrefix", { exact: false }).waitFor();
    await page.getByText("Usage evidence", { exact: true }).click();
    await page.getByText("Service activity, commands, object state and faults", { exact: true }).click();
    await page.getByRole("heading", { name: "Last durable result" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, "report-desktop.png") });
    const complete = await read(completeId);
    expect(complete.evidence.model.commands.results).toHaveLength(3);
    proof.complete = await retain(completeId);
    const barrier = await captureBarrier(h);
    try {
      await page.goto(h.origin + "/internal/model2"); const id = await execute(); await barrier.waiting(); await h.stop("worker"); await barrier.release(); await barrier.close();
      await page.getByRole("button", { name: "Refresh durable report" }).click(); await page.getByText("capture 3", { exact: false }).waitFor();
      await h.startWorker(); await until(async () => (await read(id)).status === "interrupted" || undefined, "browser report safe interruption");
      await page.getByRole("button", { name: "Refresh durable report" }).click(); await page.getByText("Status: interrupted", { exact: false }).waitFor();
      await page.getByRole("button", { name: "Verify deterministic replay" }).click(); await page.getByText("Matches a prefix only", { exact: false }).waitFor();
      proof.interrupted = await retain(id);
    } finally { await barrier.close(); }
    const cancelling = await captureBarrier(h);
    try {
      await page.goto(h.origin + "/internal/model2"); const id = await execute(); await cancelling.waiting();
      const click = page.getByRole("button", { name: "Cancel this run" }).click();
      await until(async () => (await h.sql.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND query LIKE 'UPDATE "InternalModel2Run" SET "cancelRequested"=%' AND wait_event_type='Lock'`)).rowCount ? true : undefined, "real browser cancellation waits for capture row");
      await cancelling.release(); await click;
      await until(async () => (await read(id)).status === "cancelled" || undefined, "running GUI cancellation");
      await page.getByRole("button", { name: "Refresh durable report" }).click(); await page.getByText("Status: cancelled", { exact: false }).waitFor();
      proof.cancelled = await retain(id);
      proof.cases.push("running GUI cancellation retains committed prefix");
    } finally { await cancelling.close(); }
    await page.goto(h.origin + `/internal/model2?run=${completeId}`);
    await alterRecordedField(h, completeId, "evidence", {}, async () => {
      await page.getByRole("button", { name: "Refresh durable report" }).click(); await page.getByText("Stored evidence is missing, corrupt or incompatible", { exact: false }).waitFor();
      expect(await page.getByRole("button", { name: "Verify deterministic replay" }).isDisabled()).toBe(true);
    });
    await alterRecordedField(h, completeId, "evidence", complete.evidence, async () => {});
    const changed = structuredClone(complete.input); changed.source = "f".repeat(64); const { fingerprint: _oldInput, ...inputBody } = changed; void _oldInput; changed.fingerprint = contentHash(inputBody);
    const history = structuredClone(complete.evidence); history.source = changed.source; history.input = changed.fingerprint; const { fingerprint: _oldCapture, ...captureBody } = history; void _oldCapture; history.fingerprint = contentHash(captureBody);
    const db = await h.sql.connect();
    const rewrite = async (input: unknown, hash: string, evidence: unknown) => { await db.query("BEGIN"); try { await db.query('ALTER TABLE "InternalModel2Run" DISABLE TRIGGER internal_model2_guard'); await db.query('UPDATE "InternalModel2Run" SET input=$2,"inputHash"=$3,evidence=$4 WHERE id=$1', [completeId, input, hash, evidence]); await db.query('ALTER TABLE "InternalModel2Run" ENABLE TRIGGER internal_model2_guard'); await db.query("COMMIT"); } catch (e) { await db.query("ROLLBACK"); throw e; } };
    try { await rewrite(changed, changed.fingerprint, history); await page.getByRole("button", { name: "Refresh durable report" }).click(); await page.getByText("Execution source differs", { exact: false }).waitFor(); expect(await page.getByRole("button", { name: "Verify deterministic replay" }).isDisabled()).toBe(true); }
    finally { await rewrite(complete.input, complete.inputHash, complete.evidence); db.release(); }
    await page.getByRole("button", { name: "Refresh durable report" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
    await page.getByRole("heading", { name: "Last durable result" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, "report-mobile.png") });
    const other = await browser.newContext(); await addSession(other, bob.cookie); const second = await other.newPage();
    await second.goto(h.origin + `/internal/model2?run=${completeId}`); await second.getByText("Internal workspace unavailable for this session", { exact: false }).waitFor();
    expect(await second.getByText("Observed modeled facts", { exact: true }).count()).toBe(0); await other.close();
    await h.sql.query('DELETE FROM "InternalModel2Grant" WHERE "userId"=$1', [alice.user.id]);
    await page.getByRole("button", { name: "Refresh durable report" }).click(); await page.getByText("Internal workspace unavailable for this session", { exact: false }).waitFor();
    await context.clearCookies(); await page.reload(); await page.waitForURL(/\/signin/);
    proof.cases.push("real saved design → author → review → worker → report", "deterministic GUI replay", "worker-absent interrupted report", "corrupt evidence", "historical source mismatch", "mobile no page overflow", "two browser owner isolation", "grant revocation", "lost session");
    proof.success = true;
  } catch (error) {
    proof.failure = error instanceof Error ? error.message : String(error);
    await page.screenshot({ path: join(output, "failure.png"), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    h.cookie = cookie; await h.stop("worker"); await browser.close(); server.kill("SIGKILL"); await server.exited;
    const owned = (await h.sql.query('SELECT id FROM "InternalModel2Run" WHERE "ownerId"=$1', [alice.user.id])).rows.map((r) => r.id);
    await h.sql.query('UPDATE "InternalModel2Run" SET status=\'failed\',reason=\'Disposable browser cleanup\' WHERE "ownerId"=$1 AND status IN (\'queued\',\'running\')', [alice.user.id]);
    await h.sql.query('DELETE FROM "Outbox" WHERE payload->>\'internalModel2RunId\'=ANY($1::text[])', [owned]);
    await h.sql.query('DELETE FROM "InternalModel2Run" WHERE "ownerId"=$1', [alice.user.id]);
    await h.sql.query('DELETE FROM "InternalModel2Grant" WHERE "userId"=ANY($1::text[])', [[alice.user.id, bob.user.id]]);
    proof.rowsRemoved = true;
    proof.endedAt = new Date().toISOString();
    const serialized = JSON.stringify(proof); expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(1048576);
    await Bun.write(join(output, "browser-proof.json"), serialized);
    console.info(`M2L_BROWSER_PROOF ${JSON.stringify({ success: proof.success, commit: proof.commit, browser: proof.browser, cases: proof.cases, run: proof.complete?.id, bytes: Buffer.byteLength(serialized), content: contentHash(proof) })}`);
  }
  return proof;
}
