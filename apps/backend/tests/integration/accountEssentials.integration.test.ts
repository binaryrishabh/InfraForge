import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import express from "express";
import { createServer } from "node:http";
import { PrismaClient } from "../../lib/generated/prisma/client";
import { readLocalSettings, until } from "./localHarness";
import { createAuth } from "../../auth/createAuth";
import { readAuthSettings } from "../../auth/settings";
import { FakeEmail } from "../../auth/email";
import { FakeChallenge } from "../../auth/turnstile";
import { accountRouter } from "../../auth/accountRoutes";
import { createOriginCheck } from "../../auth/origin";
import { deleteAccount, exportAccountPage, exportSections } from "../../auth/accountData";
import { checkAccountSchema } from "../../release/accountSchema";
import { checkFirstStackSchema } from "../../release/firstStackSchema";
import { submissionFixture } from "../submissionFixture";
import { createSubmissionService } from "../../firstStack/admission";

(process.env.INTEGRATION_RUN === "1" ? test : test.skip)("account migration, re-authentication, isolated export and immutable-history deletion", async () => {
  const settings = readLocalSettings(process.env);
  const admin = new Pool({ connectionString: settings.databaseUrl });
  const name = `infraforge_it_${randomUUID().replaceAll("-", "")}`, target = new URL(settings.databaseUrl); target.pathname = `/${name}`;
  await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
  const sql = new Pool({ connectionString: target.href, max: 3 });
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.href, max: 3 }) });
  const server = createServer();
  try {
    const folder = new URL("../../prisma/migrations/", import.meta.url);
    const migrations = (await readdir(folder, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name).sort();
    for (const migration of migrations.slice(0, -1)) await sql.query(await Bun.file(new URL(`${migration}/migration.sql`, folder)).text());
    await sql.query('INSERT INTO "User" (id,name,email,"updatedAt") VALUES (\'legacy\',\'Preserved\',\'legacy@example.test\',now())');
    const before = (await sql.query('SELECT * FROM "User"')).rows[0];
    await sql.query(await Bun.file(new URL(`${migrations.at(-1)}/migration.sql`, folder)).text());
    const { deletedAt, ...preserved } = (await sql.query('SELECT * FROM "User" WHERE id=\'legacy\'')).rows[0];
    expect(preserved).toEqual(before); expect(deletedAt).toBeNull();
    await checkAccountSchema(sql); await checkFirstStackSchema(sql);
    const mail = new FakeEmail(), quota = { allow: async () => true };
    const origin = "http://localhost:5173", password = "fixture-password-long-enough";
    const auth = createAuth(db, { ...readAuthSettings({ BETTER_AUTH_URL: "http://localhost:3100", APP_ORIGINS: origin,
      BETTER_AUTH_SECRET: randomUUID() + randomUUID() }), accountEssentials: { enabled: true, email: mail, challenge: new FakeChallenge(), siteKey: "fixture" } }, quota);
    const create = async (username: string) => {
      const messageCount = mail.messages.length;
      const response = await auth.api.signUpEmail({ body: { username, name: username, email: `${username}@example.test`, password, turnstileToken: "fixture" } as any });
      // Verification is the native endpoint; token comes from the injected email fake.
      await until(async () => mail.messages.length > messageCount || undefined, "account verification delivery");
      const url = new URL(mail.messages.at(-1)!.text.split(" ").at(-1)!);
      await auth.api.verifyEmail({ query: { token: url.searchParams.get("token")! } });
      const login = await auth.api.signInEmail({ body: { email: `${username}@example.test`, password }, asResponse: true });
      return { id: response.user.id, cookie: login.headers.getSetCookie().find(c => c.startsWith("better-auth.session_token="))!.split(";")[0]! };
    };
    const alice = await create("alice"), bob = await create("bobby");
    const a = await submissionFixture(alice.id), b = await submissionFixture(bob.id);
    for (const [user, fixture] of [[alice, a], [bob, b]] as const) {
      fixture.request.infrastructureId = randomUUID();
      await db.infrastructure.create({ data: { id: fixture.request.infrastructureId, userId: user.id, ownerId: user.id, name: `${user.id} personal design`, layout: JSON.parse(JSON.stringify(fixture.layout)),
        updatedAt: new Date(fixture.request.expectedDesignUpdatedAt) } });
    }
    const service = createSubmissionService(sql, { enabled: true, engine: a.engine });
    const privateRun = await service.submit(alice.id, { ...a.request, purpose: "private" });
    await service.submit(bob.id, { ...b.request, purpose: "private" });
    const immutableBefore = (await sql.query('SELECT * FROM "FirstStackRun" WHERE "ownerId"=$1', [alice.id])).rows;
    const resultBefore = (await sql.query('SELECT * FROM "FirstStackResult" WHERE "runId"=$1', [privateRun.id])).rows;
    // Cross-user cursors cannot grant access, and worker fence tokens never export.
    for (const section of exportSections) {
      const page = await exportAccountPage(db, alice.id, section);
      expect(JSON.stringify(page)).not.toContain(bob.id);
      expect(JSON.stringify(page)).not.toContain('"token"');
    }
    const app = express(); app.use(createOriginCheck([origin]), express.json({ limit: "8kb" }), accountRouter(db, auth, quota, true));
    app.use((e: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(e.statusCode ?? 500).json({ success: false }));
    server.on("request", app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw Error("No test port");
    const call = (path: string, body?: object, headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: body ? "POST" : "GET", headers: { Cookie: alice.cookie, Origin: origin, "Content-Type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined,
    });
    expect((await call("/delete", { password, confirmation: "DELETE" }, { Origin: "http://evil.invalid" })).status).toBe(403);
    expect((await call("/delete", { password, confirmation: "DELETE" }, { Origin: "" })).status).toBe(403);
    expect((await call("/delete", { password: "wrong-password", confirmation: "DELETE" })).status).toBe(403);
    expect((await call("/delete", { password, confirmation: "yes" })).status).toBe(400);
    expect((await call("/delete", { password, confirmation: "DELETE", userId: bob.id })).status).toBe(400);
    const exported = await call("/export?section=results"); expect(exported.status).toBe(200);
    expect((await exported.json() as any).records[0].runId).toBe(privateRun.id);
    await db.deployment.create({ data: { ownerId: alice.id, infrastructureId: a.request.infrastructureId, status: "pending" } });
    expect((await call("/delete", { password, confirmation: "DELETE" })).status).toBe(409);
    await db.deployment.updateMany({ where: { ownerId: alice.id }, data: { status: "failed" } });
    expect((await call("/delete", { password, confirmation: "DELETE" })).status).toBe(200);
    const removed = await db.user.findUniqueOrThrow({ where: { id: alice.id } });
    expect(removed.name).toBe("Deleted account"); expect(removed.username).toBeNull(); expect(removed.email).toEndWith("@deleted.invalid");
    expect(await db.session.count({ where: { userId: alice.id } })).toBe(0);
    expect(await db.account.count({ where: { userId: alice.id } })).toBe(0);
    expect(await db.accountEmailToken.count({ where: { userId: alice.id } })).toBe(0);
    expect((await call("/export?section=results")).status).toBe(401);
    expect((await sql.query('SELECT * FROM "FirstStackRun" WHERE "ownerId"=$1', [alice.id])).rows).toEqual(immutableBefore);
    expect((await sql.query('SELECT * FROM "FirstStackResult" WHERE "runId"=$1', [privateRun.id])).rows).toEqual(resultBefore);
    expect((await db.infrastructure.findUniqueOrThrow({ where: { id: a.request.infrastructureId } })).layout).toEqual({});
    expect((await db.user.findUniqueOrThrow({ where: { id: bob.id } })).email).toBe("bobby@example.test");
    await expect(db.session.create({ data: { id: randomUUID(), token: randomUUID(), userId: alice.id, expiresAt: new Date(Date.now() + 60000) } })).rejects.toThrow();
    await expect(db.account.create({ data: { id: randomUUID(), accountId: alice.id, userId: alice.id, providerId: "credential" } })).rejects.toThrow();
    await expect(db.user.update({ where: { id: alice.id }, data: { deletedAt: null } })).rejects.toThrow();
    await expect(deleteAccount(db, alice.id)).rejects.toMatchObject({ statusCode: 401 });
  } finally {
    server.closeAllConnections(); if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    await db.$disconnect(); await sql.end(); await admin.query(`DROP DATABASE "${name}"`); await admin.end();
  }
}, 60000);
