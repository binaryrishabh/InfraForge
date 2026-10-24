import { expect, test } from "bun:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { symmetricEncrypt } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import { createAuth } from "../auth/createAuth";
import { readAuthSettings } from "../auth/settings";
import { accountAuthHandler } from "../auth/accountPolicy";
import { FakeEmail } from "../auth/email";
import { prepareMailIntent, renderMailIntent, type MailKind } from "../auth/mailIntent";

export const password = "fixture-only-password-long-enough";
export function admissionFixture() {
  const database: Record<string, any[]> = { user: [], account: [], session: [], verification: [] };
  const settings = readAuthSettings({
    BETTER_AUTH_SECRET: "fixture-only-secret-at-least-32-characters",
    BETTER_AUTH_URL: "http://localhost:3100", APP_ORIGINS: "http://localhost:5173",
  });
  const mail = new FakeEmail();
  const intents: any[] = [];
  let failing = false;
  const queue = {
    // Retain the old hook only to reproduce the reviewed behavior before wiring.
    enqueue: async (message: any) => {
      if (failing) throw Error("fixture admission unavailable");
      await mail.send(message);
    },
    admit: async (kind: MailKind, email: string, callbackURL: string) => {
      if (failing) throw Error("fixture admission unavailable");
      intents.push({ id: randomUUID(), kind, expiresAt: new Date(Date.now() + 1800_000),
        payload: await symmetricEncrypt({ key: settings.secret, data: JSON.stringify({ email, callbackURL }) }) });
    },
  };
  const options = createAuth({} as any, { ...settings, accountEssentials: {
    ...settings.accountEssentials, emailEnabled: true, email: mail,
  } }, { allow: async () => true }, queue).options;
  const auth = betterAuth({ ...options, database: memoryAdapter(database), rateLimit: { enabled: false } });
  const handler = accountAuthHandler(auth.handler, true, Date.now, async () => {});
  const call = (path: string, body: object) => handler(new Request(`${settings.baseURL}/api/auth/${path}`, {
    method: "POST", headers: { Origin: settings.origins[0]!, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  const drain = async () => {
    for (const intent of intents.splice(0)) {
      const tx = {
        verification: { create: async ({ data }: any) => database.verification!.push(data) },
        $queryRaw: async (_parts: unknown, email: string) => database.user!.filter(u => u.email === email),
      };
      const prepared = await prepareMailIntent(tx as any, intent, settings);
      if (prepared) await mail.send(await renderMailIntent({ ...intent, ...prepared }, settings));
    }
  };
  const signup = (username = "learner", email = "learner@example.test", emailProof?: string) =>
    call("sign-up/email", { username, email, emailProof, name: "Fixture", password });
  return { database, call, signup, mail, intents, drain, fail: () => { failing = true; } };
}

test("initial signup sends mailbox proof equally for taken and free usernames without creating accounts", async () => {
  const f = admissionFixture();
  f.database.user!.push({ id: "existing", username: "taken", email: "existing@example.test", emailVerified: false });
  for (const username of ["taken", "free_name"]) {
    const response = await f.signup(username, `${username}@example.test`);
    expect(response.status).toBe(200);
    expect(f.intents).toHaveLength(1);
    await f.drain();
  }
  expect(f.mail.messages).toHaveLength(2);
  expect(f.mail.messages.every(m => m.text.includes("emailProof="))).toBe(true);
  expect(f.database.user).toHaveLength(1);
});

test("admission outages fail uniformly before account creation or reset token issuance", async () => {
  for (const path of ["sign-up/email", "request-password-reset", "send-verification-email"]) {
    const f = admissionFixture();
    f.database.user!.push({ id: "existing", username: "taken", email: "existing@example.test", emailVerified: false });
    f.fail();
    const responses = [];
    for (const email of ["existing@example.test", "absent@example.test"]) {
      const result = await f.call(path, { email, username: "free_name", name: "Fixture", password });
      responses.push({ status: result.status, body: await result.text() });
    }
    expect(responses[0]!.status).toBe(503);
    expect(responses[1]).toEqual(responses[0]);
    expect(f.database.user).toHaveLength(1);
    expect(f.database.verification).toHaveLength(0);
    expect(f.intents).toHaveLength(0);
  }
});

test("accepted reset leaves recoverable intent before token generation or provider delivery", async () => {
  const f = admissionFixture();
  f.database.user!.push({ id: "existing", email: "existing@example.test", emailVerified: true });
  expect((await f.call("request-password-reset", { email: "existing@example.test" })).status).toBe(200);
  expect(f.intents).toHaveLength(1);
  expect(f.database.verification).toHaveLength(0);
  expect(f.mail.messages).toHaveLength(0);
  await f.drain();
  expect(f.database.verification).toHaveLength(1);
  expect(f.mail.messages).toHaveLength(1);
});

test("mailbox proof binds email, expires, redeems once and precedes username availability", async () => {
  const f = admissionFixture();
  f.database.user!.push({ id: "existing", username: "taken", email: "existing@example.test", emailVerified: true });
  await f.signup("taken");
  await f.drain();
  const proof = new URL(f.mail.messages[0]!.text.split("\n").at(-1)!).searchParams.get("emailProof")!;
  expect((await f.signup("taken", "learner@example.test", "x".repeat(43))).status).toBe(400);
  expect((await f.signup("free_name", "other@example.test", proof)).status).toBe(400);
  const taken = await f.signup("taken", "learner@example.test", proof);
  expect((await taken.json() as { code?: string }).code).toBe("USERNAME_IS_ALREADY_TAKEN");
  expect(f.database.verification).toHaveLength(1);
  const completed = await f.signup("free_name", "learner@example.test", proof);
  expect(completed.status).toBe(200);
  expect(completed.headers.get("set-cookie")).toBeNull();
  expect(f.database.user!.find(u => u.email === "learner@example.test").emailVerified).toBe(true);
  expect(f.database.verification).toHaveLength(0);
  expect((await f.signup("another", "learner@example.test", proof)).status).toBe(400);
  await f.signup("expired", "expired@example.test");
  await f.drain();
  const expired = new URL(f.mail.messages.at(-1)!.text.split("\n").at(-1)!).searchParams.get("emailProof")!;
  f.database.verification![0].expiresAt = new Date(0);
  expect((await f.signup("expired", "expired@example.test", expired)).status).toBe(400);
});

test("intent-issued reset redeems through native hashing, consumes once and revokes sessions", async () => {
  const f = admissionFixture();
  await f.signup(); await f.drain();
  const proof = new URL(f.mail.messages[0]!.text.split("\n").at(-1)!).searchParams.get("emailProof")!;
  expect((await f.signup("learner", "learner@example.test", proof)).status).toBe(200);
  expect((await f.call("sign-in/email", { email: "learner@example.test", password })).status).toBe(200);
  expect(f.database.session!.length).toBeGreaterThan(0);
  await f.call("request-password-reset", { email: "learner@example.test" }); await f.drain();
  const token = new URL(f.mail.messages.at(-1)!.text.split("\n").at(-1)!).pathname.split("/").at(-1)!;
  const stored = f.database.verification![0].identifier;
  expect((await f.call("reset-password", { token: stored, newPassword: password })).status).toBe(400);
  expect((await f.call("reset-password", { token, newPassword: password })).status).toBe(200);
  expect(f.database.session).toHaveLength(0);
  expect((await f.call("reset-password", { token, newPassword: password })).status).toBe(400);
});
