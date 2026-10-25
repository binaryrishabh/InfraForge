import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { Pool } from "pg";
import express from "express";
import cors from "cors";
import { betterAuth } from "better-auth";
import { hashPassword } from "better-auth/crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../lib/generated/prisma/client";
import { readLocalSettings } from "./localHarness";
import { loginEnvironment } from "../loginMethodsFixture";
import { readAuthSettings } from "../../auth/settings";
import { createAuth } from "../../auth/createAuth";
import { FakeEmail } from "../../auth/email";
import { AccountEmailRequests } from "../../auth/mailRequests";
import { methodSettingsRouter, unlinkMethod } from "../../auth/methodSettings";
import { createOriginCheck } from "../../auth/origin";
import { HOSTED_LOGIN_ORIGIN } from "../../auth/loginMethods";
import { deleteAccount } from "../../auth/accountData";
import { accountAuthHandler } from "../../auth/accountPolicy";

(process.env.INTEGRATION_RUN === "1" ? test : test.skip)(
  "PostgreSQL email login, concurrent redemption/removal, account ownership and hosted origins", async () => {
    const local = readLocalSettings(process.env), admin = new Pool({ connectionString: local.databaseUrl });
    const target = new URL(local.databaseUrl), name = `infraforge_it_${randomUUID().replaceAll("-", "")}`;
    target.pathname = `/${name}`;
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    const sql = new Pool({ connectionString: target.href, max: 3 });
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.href, max: 3 }) });
    let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
    try {
      const folder = new URL("../../prisma/migrations/", import.meta.url);
      for (const migration of (await readdir(folder, { withFileTypes: true }))
        .filter(d => d.isDirectory()).map(d => d.name).sort()) {
        await sql.query(await Bun.file(new URL(`${migration}/migration.sql`, folder)).text());
      }
      const settings = readAuthSettings({ ...loginEnvironment, NODE_ENV: "test", AUTH_EMAIL_ENABLED: "true",
        AUTH_MAGIC_LINK_ENABLED: "true", AUTH_EMAIL_OTP_ENABLED: "true", AUTH_METHOD_SETTINGS_ENABLED: "true",
        AUTH_ACCOUNT_LINKING_ENABLED: "true", AUTH_HOSTED_LOGIN_ENABLED: "true", TURNSTILE_DEV_BYPASS: "true",
        TRANSACTIONAL_EMAIL_PROVIDER: "resend", TRANSACTIONAL_EMAIL_FROM: "auth@example.test", RESEND_API_KEY: "fixture",
        GOOGLE_CLIENT_ID: "fixture", GOOGLE_CLIENT_SECRET: "fixture" });
      const mail = new FakeEmail(), queue = new AccountEmailRequests(db, mail, settings);
      const quota = { allow: async () => true };
      const options = createAuth(db, settings, quota, queue).options;
      const auth = betterAuth({ ...options, rateLimit: { enabled: false } });
      const handler = accountAuthHandler(auth.handler, true, Date.now, async () => {}, settings.loginMethods);
      const call = (path: string, body?: object, cookie?: string) => handler(new Request(
        `${settings.baseURL}/api/auth/${path}`, { method: body ? "POST" : "GET",
          headers: { Origin: HOSTED_LOGIN_ORIGIN, "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}) }));
      const password = "fixture-password-long-enough", hashed = await hashPassword(password);
      const user = await db.user.create({ data: { id: randomUUID(), name: "Fixture", email: "victim@example.test",
        emailVerified: true, createdAt: new Date(), updatedAt: new Date() } });
      const other = await db.user.create({ data: { id: randomUUID(), name: "Other", email: "other@example.test",
        emailVerified: true, createdAt: new Date(), updatedAt: new Date() } });
      const credential = await db.account.create({ data: { id: randomUUID(), userId: user.id, accountId: user.id,
        providerId: "credential", password: hashed, createdAt: new Date(), updatedAt: new Date() } });
      const foreign = await db.account.create({ data: { id: randomUUID(), userId: other.id, accountId: other.id,
        providerId: "credential", password: hashed, createdAt: new Date(), updatedAt: new Date() } });
      const magic = async () => {
        expect((await call("sign-in/magic-link", { email: user.email })).status).toBe(200);
        await queue.drain();
        return new URL(mail.messages.at(-1)!.text.split("\n").at(-1)!).href.split("/api/auth/")[1]!;
      };
      let path = await magic();
      const results = await Promise.all([call(path), call(path)]);
      expect(results.filter(r => r.headers.has("set-cookie"))).toHaveLength(1);
      expect(await db.session.count({ where: { userId: user.id } })).toBe(1);
      const otp = async () => {
        expect((await call("email-otp/send-verification-otp", { email: user.email, type: "sign-in" })).status).toBe(200);
        await queue.drain(); return mail.messages.at(-1)!.text.match(/\b\d{6}\b/)![0];
      };
      let code = await otp();
      const wrong = code === "000000" ? "000001" : "000000";
      for (let i = 0; i < 3; i++) {
        expect((await call("sign-in/email-otp", { email: user.email, otp: wrong })).ok).toBe(false);
      }
      expect((await call("sign-in/email-otp", { email: user.email, otp: code })).ok).toBe(false);
      code = await otp();
      const redeemed = await Promise.all([call("sign-in/email-otp", { email: user.email, otp: code }),
        call("sign-in/email-otp", { email: user.email, otp: code })]);
      expect(redeemed.filter(r => r.ok)).toHaveLength(1);
      const login = await call("sign-in/email", { email: user.email, password });
      const cookie = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
      expect(cookie).toContain("session_token"); expect(cookie.toLowerCase()).not.toContain("domain=");
      const current = await auth.api.getSession({ headers: new Headers({ cookie }) });
      const foreignSession = await (await auth.$context).internalAdapter.createSession(other.id);
      const app = express();
      app.use(createOriginCheck(settings.origins), cors({ origin: settings.origins, credentials: true }), express.json());
      app.use(methodSettingsRouter(db, auth, quota, settings));
      app.use((error: any, _req: any, res: any, _next: any) => {
        res.status(error.statusCode ?? 500).json({ success: false });
      });
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>(resolve => server!.once("listening", resolve));
      const address = server.address() as { port: number };
      const api = (route: string, body?: object, origin = HOSTED_LOGIN_ORIGIN) => fetch(
        `http://127.0.0.1:${address.port}/${route}`, { method: body ? "POST" : "GET",
          headers: { cookie, Origin: origin, "Content-Type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}) });
      settings.loginMethods.settings = false;
      expect((await api("methods")).status).toBe(404);
      settings.loginMethods.settings = true;
      expect((await fetch(`http://127.0.0.1:${address.port}/methods`, {
        headers: { Origin: HOSTED_LOGIN_ORIGIN },
      })).status).toBe(401);
      const methods = await api("methods");
      expect(methods.headers.get("access-control-allow-origin")).toBe(HOSTED_LOGIN_ORIGIN);
      const methodBody = await methods.text(); expect(methodBody).toContain(credential.id);
      expect(methodBody).not.toContain(foreign.id); expect(methodBody).not.toContain(hashed);
      expect((await api("methods", undefined, "https://evil.test")).status).toBe(403);
      expect((await api("unlink", { accountId: credential.id, password: "wrong" })).status).toBe(403);
      expect((await api("unlink", { accountId: foreign.id, password })).status).toBe(404);
      expect((await api("unlink", { accountId: credential.id, password })).status).toBe(409);
      expect((await call("unlink-account", { accountId: credential.id }, cookie)).status).toBe(404);
      const sessions = await (await api("sessions")).text();
      expect(sessions).not.toContain(foreignSession.id); expect(sessions).not.toContain(current!.session.token);
      expect((await api("sessions/revoke", { sessionId: foreignSession.id })).status).toBe(404);
      const extra = await (await auth.$context).internalAdapter.createSession(user.id);
      expect((await api("sessions/revoke", { sessionId: extra.id })).status).toBe(200);
      expect((await api("sessions/revoke-others", {})).status).toBe(200);
      expect(await db.session.count({ where: { userId: user.id } })).toBe(1);
      expect(await db.session.count({ where: { userId: other.id } })).toBe(1);
      const social = await db.account.create({ data: { id: randomUUID(), userId: user.id, accountId: "google-fixture",
        providerId: "google", createdAt: new Date(), updatedAt: new Date() } });
      const removals = await Promise.allSettled([unlinkMethod(db, user.id, current!.session.id, credential.id, ["google"]),
        unlinkMethod(db, user.id, current!.session.id, social.id, ["google"])]);
      expect(removals.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect(await db.account.count({ where: { userId: user.id } })).toBe(1);
      const stale = await (await auth.$context).internalAdapter.createSession(user.id);
      await db.session.delete({ where: { id: stale.id } });
      let staleError: unknown;
      try { await unlinkMethod(db, user.id, stale.id, credential.id, ["google"]); }
      catch (error) { staleError = error; }
      expect(staleError).toBeInstanceOf(Error);
      expect((staleError as Error).message).toBe("Sign in to continue");
      // Retired mailbox proofs must not follow a newly registered account.
      path = await magic(); code = await otp();
      await deleteAccount(db, user.id);
      await db.user.create({ data: { id: randomUUID(), name: "Replacement", email: user.email,
        emailVerified: true, createdAt: new Date(), updatedAt: new Date() } });
      expect((await call(path)).headers.has("set-cookie")).toBe(false);
      expect((await call("sign-in/email-otp", { email: user.email, otp: code })).ok).toBe(false);
      expect(await db.accountEmailToken.count({ where: { userId: user.id } })).toBe(0);
    } finally {
      if (server) await new Promise<void>(resolve => { server!.close(() => resolve()); server!.closeAllConnections(); });
      await db.$disconnect(); await sql.end();
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); await admin.end();
    }
  }, 120000);
