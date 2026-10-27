import { expect } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import type { LocalHarness } from "./localHarness";
import type { SessionFixtures } from "./sessionFixtures";

// Public HTTP routes and real database-backed sessions. No fixture authentication,
// provider credentials or password values are written to diagnostics/evidence.
export async function checkCredentials(harness: LocalHarness, fixtures: SessionFixtures) {
  const users: string[] = [];
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const username = `Learner_${suffix}`;
  const email = `${suffix}@infraforge.test`;
  const password = randomBytes(24).toString("base64url") + "Aa1!";
  let requestNumber = 1;
  const call = async (path: string, body?: object, options: { cookie?: string; origin?: string; ip?: string } = {}) => {
    const response = await fetch(harness.api + "/auth/" + path, {
      method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", Origin: options.origin ?? harness.origin,
        Cookie: options.cookie ?? "", "X-Forwarded-For": options.ip ?? `192.0.2.${requestNumber++}` }, body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    expect(text.includes(password)).toBe(false);
    expect(/"password"\s*:/.test(text)).toBe(false);
    const data = response.headers.get("Content-Type")?.includes("application/json") && text ? JSON.parse(text) : null;
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith("better-auth.session_token="))?.split(";")[0] ?? "";
    return { status: response.status, data, cookie, cookies: response.headers.getSetCookie() };
  };
  const signup = (extra: object) => call("sign-up/email", { username, name: username, email, password, ...extra });
  try {
    expect((await call("providers")).data).toEqual({ credentials: true, providers: [] });
    expect((await signup({ password: "x".repeat(9000) })).status).toBe(413);
    for (const extra of [{ username: undefined }, { username: "aa" }, { username: "1name" }, { username: "user@email" },
      { username: "a".repeat(31) }, { username: "name space" }, { username: "léarner" },
      { email: "not-email" }, { password: "short" }, { password: "x".repeat(129) }]) {
      expect((await signup(extra)).status).toBeGreaterThanOrEqual(400);
    }
    expect((await harness.sql.query('SELECT count(*)::int AS n FROM "User" WHERE email=$1', [email])).rows[0].n).toBe(0);
    const alice = await signup({ email: email.toUpperCase() });
    expect(alice.status).toBe(200); users.push(alice.data.user.id);
    expect(alice.data.user).toMatchObject({ username: username.toLowerCase(), email, emailVerified: false });
    expect(alice.cookie.length > 0).toBe(true);
    expect(alice.cookies.some((value) => /HttpOnly/i.test(value) && /SameSite=Lax/i.test(value) && !/Domain=/i.test(value))).toBe(true);
    const account = (await harness.sql.query('SELECT "providerId",password FROM "Account" WHERE "userId"=$1', [users[0]])).rows[0];
    expect(account.providerId).toBe("credential");
    expect(typeof account.password === "string" && account.password !== password && account.password.includes(":" )).toBe(true);
    expect((await call("get-session", undefined, { cookie: alice.cookie })).data.user.id).toBe(users[0]);
    const sessionsBefore = (await harness.sql.query('SELECT count(*)::int AS n FROM "Session"')).rows[0].n;
    for (const identifier of [username, `Unknown_${suffix}`]) {
      const failed = await call("sign-in/identifier", { identifier, password: "wrong-password-long" });
      expect(failed.status).toBe(401);
      expect(failed.data.code).toBe("INVALID_USERNAME_OR_PASSWORD");
    }
    for (const identifier of [email, `absent-${email}`]) {
      const failed = await call("sign-in/identifier", { identifier, password: "wrong-password-long" });
      expect(failed.status).toBe(401);
      expect(failed.data.code).toBe("INVALID_EMAIL_OR_PASSWORD");
    }
    expect((await harness.sql.query('SELECT count(*)::int AS n FROM "Session"')).rows[0].n).toBe(sessionsBefore);
    expect((await call("sign-out", {}, { cookie: alice.cookie })).status).toBe(200);
    expect((await call("get-session", undefined, { cookie: alice.cookie })).data).toBeNull();
    const byEmail = await call("sign-in/identifier", { identifier: email.toUpperCase(), password });
    expect(byEmail.status).toBe(200); expect(byEmail.data.user.id).toBe(users[0]);
    await call("sign-out", {}, { cookie: byEmail.cookie });
    const byName = await call("sign-in/identifier", { identifier: username.toUpperCase(), password });
    expect(byName.status).toBe(200); expect(byName.data.user.id).toBe(users[0]);
    await harness.sql.query('UPDATE "Session" SET "expiresAt"=now()-interval \'1 second\' WHERE "userId"=$1', [users[0]]);
    expect((await call("get-session", undefined, { cookie: byName.cookie })).data).toBeNull();
    for (const extra of [{ username: username.toLowerCase(), email: `new-${email}` }, { username: `Another_${suffix}`, email: email.toUpperCase() }]) {
      expect((await signup(extra)).status).toBeGreaterThanOrEqual(400);
    }
    const raceUsername = `Race_${suffix}`;
    const race = await Promise.all(["a", "b"].map((n) => signup({ username: raceUsername, email: `${n}-${email}` })));
    expect(race.filter((item) => item.status === 200)).toHaveLength(1);
    users.push(race.find((item) => item.status === 200)!.data.user.id);
    expect((await harness.sql.query('SELECT count(*)::int AS n FROM "Account" WHERE "userId"=ANY($1::text[])', [users])).rows[0].n).toBe(2);
    const oauth = await fixtures.create();
    const oauthBefore = (await harness.sql.query('SELECT * FROM "User" WHERE id=$1', [oauth.user.id])).rows[0];
    expect((await signup({ username: `Oauth_${suffix}`, email: oauth.user.email })).status).toBe(422);
    expect((await harness.sql.query('SELECT * FROM "User" WHERE id=$1', [oauth.user.id])).rows[0]).toEqual(oauthBefore);
    expect((await harness.sql.query('SELECT count(*)::int AS n FROM "Account" WHERE "userId"=$1', [oauth.user.id])).rows[0].n).toBe(0);
    expect((await call("sign-in/username", { username, password }, { origin: "http://evil.invalid" })).status).toBe(403);
    expect((await call("is-username-available", { username })).data).toEqual({ available: false });
    const ip = "198.51.100.20";
    for (let n = 0; n < 3; n++) expect((await call("sign-in/username", { username, password: "wrong-password-long" }, { ip })).status).toBe(401);
    expect((await call("sign-in/username", { username, password: "wrong-password-long" }, { ip })).status).toBe(429);
    expect((await call("sign-in/identifier", { identifier: username, password: "wrong-password-long" }, { ip })).status).toBe(429);
    const session = await call("sign-in/username", { username, password });
    // Continue the entire lifecycle/isolation suite as a normal credential user.
    fixtures.track(users[0]!); users.shift();
    harness.cookie = session.cookie;
    return { signup: true, emailLogin: true, usernameLogin: true, duplicateRace: true, rateLimit: true };
  } finally {
    await fixtures.prisma.user.deleteMany({ where: { id: { in: users } } });
  }
}
