import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { randomUUID } from "node:crypto";
import { createAuth } from "../auth/createAuth";
import { readAuthSettings } from "../auth/settings";
import { accountAuthHandler } from "../auth/accountPolicy";
import { FakeChallenge } from "../auth/turnstile";
import { FakeEmail } from "../auth/email";
import { prepareMailIntent, renderMailIntent } from "../auth/mailIntent";
import { AccountEmailRequests } from "../auth/mailRequests";

export const loginEnvironment = { BETTER_AUTH_SECRET: "fixture-only-secret-at-least-32-characters",
  BETTER_AUTH_URL: "http://localhost:3100", APP_ORIGINS: "http://localhost:5173" };

export function loginFixture(flags: Record<string, string> = {}, change?: (options: any) => void) {
  const database: Record<string, any[]> = { user: [], account: [], session: [], verification: [] };
  const settings = readAuthSettings({ ...loginEnvironment, AUTH_EMAIL_ENABLED: "true",
    TRANSACTIONAL_EMAIL_PROVIDER: "resend", TRANSACTIONAL_EMAIL_FROM: "auth@example.test",
    RESEND_API_KEY: "fixture-only", TURNSTILE_DEV_BYPASS: "true", NODE_ENV: "test", ...flags });
  const challenge = new FakeChallenge();
  settings.accountEssentials.challenge = challenge;
  const mail = new FakeEmail(), intents: any[] = [], scopes: string[] = [];
  let failing = false, quotaAllowed = true;
  const ledger: any[] = [];
  const accountEmailToken = {
    create: async ({ data }: any) => ledger.push({ usedAt: null, ...data }),
    updateMany: async ({ where, data }: any) => {
      const row = ledger.find(r => r.hash === where.hash && r.userId === where.userId && !r.usedAt
        && r.expiresAt > new Date() && database.user!.some(u => u.id === r.userId && u.emailVerified && !u.deletedAt));
      if (!row) return { count: 0 };
      Object.assign(row, data); return { count: 1 };
    },
  };
  const queue = new AccountEmailRequests({ accountMailIntent: { create: async ({ data }: any) => {
    if (failing) throw Error("fixture unavailable");
    intents.push(data);
  } } } as any, mail, settings);
  const options = createAuth({ accountEmailToken } as any, settings, { allow: async scope => {
    scopes.push(scope); return quotaAllowed;
  } }, queue).options;
  change?.(options);
  const auth = betterAuth({ ...options, database: memoryAdapter(database), rateLimit: { enabled: false } });
  const handler = accountAuthHandler(auth.handler, true, Date.now, async () => {}, settings.loginMethods);
  const call = (path: string, body?: object, cookie?: string, challengeToken: string | null = "fixture-pass") => handler(new Request(
    `${settings.baseURL}/api/auth/${path}`, { method: body ? "POST" : "GET",
      headers: { Origin: settings.origins[0]!, "Content-Type": "application/json", ...(cookie ? { cookie } : {}),
        ...(challengeToken !== null ? { "x-turnstile-token": challengeToken } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) }));
  const drain = async () => {
    for (const intent of intents.splice(0)) {
      const tx = { accountEmailToken, verification: {
        create: async ({ data }: any) => database.verification!.push(data),
        deleteMany: async ({ where }: any) => {
          database.verification = database.verification!.filter(v => v.identifier !== where.identifier);
        },
      }, $queryRaw: async (_parts: unknown, email: string) => database.user!.filter(u => u.email === email) };
      const prepared = await prepareMailIntent(tx as any, intent, settings);
      if (prepared) await mail.send(await renderMailIntent({ ...intent, ...prepared }, settings));
    }
  };
  const addUser = (email = "victim@example.test", verified = true) => {
    const user = { id: randomUUID(), email, emailVerified: verified, name: "Fixture",
      createdAt: new Date(), updatedAt: new Date() };
    database.user!.push(user);
    database.account!.push({ id: randomUUID(), userId: user.id, accountId: user.id, providerId: "credential" });
    return user;
  };
  return { auth, settings, call, drain, mail, database, intents, challenge, scopes, addUser, ledger,
    fail: () => { failing = true; }, denyQuota: () => { quotaAllowed = false; } };
}
