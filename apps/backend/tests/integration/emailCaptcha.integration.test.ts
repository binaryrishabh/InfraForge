import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { createEmailVerificationToken } from "better-auth/api";
import { PrismaClient } from "../../lib/generated/prisma/client";
import { readLocalSettings } from "./localHarness";
import { readAuthSettings } from "../../auth/settings";
import { createAuth } from "../../auth/createAuth";
import { accountAuthHandler } from "../../auth/accountPolicy";
import { EmailOutbox } from "../../auth/emailOutbox";
import { FakeEmail, ResendEmail } from "../../auth/email";
import { Turnstile } from "../../auth/turnstile";
import { registerVerification } from "../../auth/verification";

(process.env.INTEGRATION_RUN === "1" ? test : test.skip)("PostgreSQL mail queue recovery, native single-use/expiry, generic identifiers and Turnstile admission", async () => {
  const local = readLocalSettings(process.env), admin = new Pool({ connectionString: local.databaseUrl });
  const name = `infraforge_it_${randomUUID().replaceAll("-", "")}`, target = new URL(local.databaseUrl); target.pathname = `/${name}`;
  await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
  const sql = new Pool({ connectionString: target.href, max: 3 });
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.href, max: 3 }) });
  try {
    const folder = new URL("../../prisma/migrations/", import.meta.url);
    for (const migration of (await readdir(folder, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name).sort()) {
      await sql.query(await Bun.file(new URL(`${migration}/migration.sql`, folder)).text());
    }
    const defaults = readAuthSettings({ BETTER_AUTH_URL: "http://localhost:3100", APP_ORIGINS: "http://localhost:5173", BETTER_AUTH_SECRET: randomUUID() + randomUUID() });
    const mail = new FakeEmail(), queue = new EmailOutbox(db, mail, defaults.secret);
    let challengeAccepted = true;
    const challenge = new Turnstile("fixture", ["localhost"], (async () => Response.json({ success: challengeAccepted, hostname: "localhost", action: "signup" })) as unknown as typeof fetch, false);
    const auth = createAuth(db, { ...defaults, accountEssentials: { ...defaults.accountEssentials, emailEnabled: true, email: mail, challenge } }, { allow: async () => true }, queue);
    const handler = accountAuthHandler(auth.handler, true);
    const password = "fixture-password-long-enough";
    let ip = 0;
    const call = (path: string, body?: object) => handler(new Request(`${defaults.baseURL}/api/auth/${path}`, {
      method: body ? "POST" : "GET", headers: { Origin: defaults.origins[0]!, "Content-Type": "application/json", "x-forwarded-for": `198.18.0.${++ip}`, "x-infraforge-client-ip": `198.18.0.${ip}` },
      body: body ? JSON.stringify(body) : undefined,
    }));
    const signup = (username: string, email: string) => call("sign-up/email", { name: "Fixture", username, email, password, turnstileToken: "fixture-token" });
    challengeAccepted = false;
    expect((await signup("blocked", "blocked@example.test")).status).toBe(403);
    expect(await db.user.count()).toBe(0); expect(await db.accountMailOutbox.count()).toBe(0);
    challengeAccepted = true;
    const fresh = await signup("learner", "learner@example.test"), accepted = await fresh.text();
    expect(fresh.status).toBe(200); expect(fresh.headers.get("set-cookie")).toBeNull();
    expect(mail.messages).toHaveLength(0); // Durable insertion precedes delivery.
    const queued = await db.accountMailOutbox.findFirstOrThrow();
    expect(queued.payload).not.toContain("learner@example.test"); expect(queued.status).toBe("pending");
    for (const [username, email] of [["learner", "other@example.test"], ["another", "learner@example.test"], ["another", "other@example.test"]]) {
      const result = await signup(username!, email!); expect(result.status).toBe(200); expect(await result.text()).toBe(accepted); expect(result.headers.get("set-cookie")).toBeNull();
    }
    expect(await db.user.count()).toBe(2); expect(await db.account.count()).toBe(2);
    // A new dispatcher/process can deliver pending rows; concurrent pollers
    // cannot claim the same live lease.
    await Promise.all([queue.drain(), new EmailOutbox(db, mail, defaults.secret).drain()]);
    expect(mail.messages).toHaveLength(2);
    const link = new URL(mail.messages.find(m => m.to === "learner@example.test")!.text.split("\n").at(-1)!);
    const token = link.searchParams.get("token")!;
    const replay = await Promise.all([call(`verify-email?token=${token}`), call(`verify-email?token=${token}`)]);
    expect(replay.map(r => r.status).sort()).toEqual([200, 400]);
    const learner = await db.user.findUniqueOrThrow({ where: { email: "learner@example.test" } });
    const expired = await createEmailVerificationToken(defaults.secret, learner.email, undefined, -1);
    await registerVerification(db, expired, learner.id);
    expect((await call(`verify-email?token=${expired}`)).status).toBe(401);
    const validButExpiredLedger = await createEmailVerificationToken(defaults.secret, learner.email, undefined, 1800, { nonce: randomUUID() });
    await registerVerification(db, validButExpiredLedger, learner.id);
    await db.accountEmailToken.updateMany({ where: { userId: learner.id }, data: { expiresAt: new Date(0) } });
    expect((await call(`verify-email?token=${validButExpiredLedger}`)).status).toBe(400);
    const reset = await call("request-password-reset", { email: learner.email });
    const absent = await call("request-password-reset", { email: "absent@example.test" });
    expect(reset.status).toBe(200); expect(await reset.text()).toBe(await absent.text());
    await queue.drain();
    const resetToken = new URL(mail.messages.at(-1)!.text.split("\n").at(-1)!).pathname.split("/").at(-1)!;
    const results = await Promise.all([call("reset-password", { token: resetToken, newPassword: password }), call("reset-password", { token: resetToken, newPassword: password })]);
    expect(results.map(r => r.status).sort()).toEqual([200, 400]);
    await call("request-password-reset", { email: learner.email }); await queue.drain();
    const expiredReset = new URL(mail.messages.at(-1)!.text.split("\n").at(-1)!).pathname.split("/").at(-1)!;
    await db.verification.updateMany({ where: { value: learner.id }, data: { expiresAt: new Date(0) } });
    expect((await call("reset-password", { token: expiredReset, newPassword: password })).status).toBe(400);

    // Provider accepts mail, database ack is lost: stable Resend keys dedupe
    // retry after restart. No real provider/network credentials are used.
    const keys = new Set<string>(); let requests = 0;
    const resend = new ResendEmail("fixture", "sender@example.test", (async (_url: string, init: RequestInit) => {
      requests++; keys.add((init.headers as Record<string, string>)["Idempotency-Key"]!); return Response.json({});
    }) as typeof fetch);
    let loseAck = true;
    const ackDb = new Proxy(db, { get(client, key) {
      if (key === "$executeRaw") return (parts: TemplateStringsArray, ...values: unknown[]) => {
        if (loseAck && parts.join("").includes("SET status = ") && values[0] === "sent") { loseAck = false; throw Error("fixture lost ack"); }
        return client.$executeRaw(parts, ...values);
      };
      return Reflect.get(client, key);
    } });
    const ackQueue = new EmailOutbox(ackDb, resend, defaults.secret);
    await ackQueue.enqueue(mail.messages[0]!, learner.id);
    let failed = false; try { await ackQueue.drain(); } catch { failed = true; }
    expect(failed).toBe(true);
    await sql.query('UPDATE "AccountMailOutbox" SET "availableAt"=now()-interval \'1 second\' WHERE status=\'sending\'');
    await new EmailOutbox(db, resend, defaults.secret).drain();
    expect(requests).toBe(2); expect(keys.size).toBe(1);
    expect(await db.accountMailOutbox.count({ where: { status: "sending" } })).toBe(0);
    expect(await db.accountMailOutbox.count({ where: { status: "sent", payload: { not: null } } })).toBe(0);
    // Database enforces the bounded-attempt and payload erasure guards itself.
    let constraintRejected = false;
    try { await sql.query('UPDATE "AccountMailOutbox" SET attempts=6'); } catch { constraintRejected = true; }
    expect(constraintRejected).toBe(true);
    await db.accountMailOutbox.updateMany({ data: { expiresAt: new Date(0) } }); await queue.drain();
    expect(await db.accountMailOutbox.count()).toBe(0);
  } finally {
    await db.$disconnect(); await sql.end(); await admin.query(`DROP DATABASE "${name}"`); await admin.end();
  }
}, 60000);
