import { expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { symmetricDecrypt } from "better-auth/crypto";
import type { PrismaClient } from "../lib/generated/prisma/client";
import { EmailOutbox } from "../auth/emailOutbox";
import { accountEmail } from "../auth/emailTemplate";
import { DeliveryError, LocalOutboxEmail, ResendEmail, SesEmail, type TransactionalEmail } from "../auth/email";
import { readAuthSettings } from "../auth/settings";
import { readChallenge, Turnstile } from "../auth/turnstile";
import { accountAuthHandler } from "../auth/accountPolicy";

const base = { BETTER_AUTH_SECRET: "fixture-only-secret-at-least-32-characters", BETTER_AUTH_URL: "https://api.example.test", APP_ORIGINS: "https://app.example.test" };
const secret = base.BETTER_AUTH_SECRET;
const message = accountEmail("recipient@example.test", "https://api.example.test/api/auth/verify-email?token=fixture&callbackURL=%2F", "verify", base.BETTER_AUTH_URL);

test("email activation is independent and production configuration fails closed", () => {
  expect(readAuthSettings(base).accountEssentials.emailEnabled).toBe(false);
  const enabled = readAuthSettings({ ...base, AUTH_EMAIL_ENABLED: "true", TRANSACTIONAL_EMAIL_PROVIDER: "resend", TRANSACTIONAL_EMAIL_FROM: "sender@example.test", RESEND_API_KEY: "fixture-key" });
  expect(enabled.accountEssentials.emailEnabled).toBe(true); expect(enabled.accountEssentials.enabled).toBe(false);
  for (const extra of [{ AUTH_EMAIL_ENABLED: "true" }, { AUTH_EMAIL_ENABLED: "yes" }, { AUTH_EMAIL_VERIFICATION_REQUIRED: "yes" },
    { TRANSACTIONAL_EMAIL_PROVIDER: "local" }, { TURNSTILE_ENABLED: "true" }, { TURNSTILE_DEV_BYPASS: "true" },
    { TRANSACTIONAL_EMAIL_PROVIDER: "resend", TRANSACTIONAL_EMAIL_FROM: "sender@example.test" },
    { TRANSACTIONAL_EMAIL_PROVIDER: "ses", TRANSACTIONAL_EMAIL_FROM: "sender@example.test", SES_REGION: "us-east-1", SES_ACCESS_KEY_ID: "fixture" }]) {
    expect(() => readAuthSettings({ ...base, NODE_ENV: "production", ...extra })).toThrow();
  }
  expect(readAuthSettings({ ...base, NODE_ENV: "test", AUTH_EMAIL_ENABLED: "true", TRANSACTIONAL_EMAIL_PROVIDER: "local" }).accountEssentials.email).toBeInstanceOf(LocalOutboxEmail);
  expect(readChallenge({ NODE_ENV: "development", TURNSTILE_DEV_BYPASS: "true" })).toBeDefined();
});

test("accessible templates contain one first-party link, escape HTML and have no remote assets", () => {
  expect(message.html).toContain('lang="en"'); expect(message.html).toContain("&amp;callbackURL=");
  expect(message.html).not.toMatch(/<img|<script|<style|src=/);
  expect(message.html!.match(/href=/g)).toHaveLength(1);
  expect(message.text).toContain("30 minutes"); expect(message.text).toContain("used once");
  expect(() => accountEmail("fixture@example.test", "https://evil.invalid/token", "reset", base.BETTER_AUTH_URL)).toThrow();
});

test("local outbox uses exclusive idempotent files and rejects path traversal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "infraforge-mail-fixture-"));
  try {
    const sender = new LocalOutboxEmail(directory);
    await sender.send(message, "fixture-id"); await sender.send(message, "fixture-id");
    expect(await readdir(directory)).toEqual(["fixture-id.json"]);
    expect(JSON.parse(await readFile(join(directory, "fixture-id.json"), "utf8"))).toEqual(message);
    await expect(sender.send(message, "../outside")).rejects.toThrow();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("HTTPS adapters send HTML and stable Resend idempotency keys; SES retries only explicit rejection", async () => {
  const requests: RequestInit[] = [];
  const transport = (async (_url: string, init: RequestInit) => { requests.push(init); return Response.json({}); }) as typeof fetch;
  const resend = new ResendEmail("fixture-key", "sender@example.test", transport);
  await resend.send(message, "same-fixture-id"); await resend.send(message, "same-fixture-id");
  expect((requests[0]!.headers as Record<string, string>)["Idempotency-Key"]).toBe("same-fixture-id");
  expect(requests[0]!.body).toBe(requests[1]!.body); expect(JSON.parse(String(requests[0]!.body)).html).toBe(message.html);
  await new SesEmail({ region: "us-east-1", accessKey: "fixture", secretKey: "fixture", from: "sender@example.test", sessionToken: "fixture-session" }, transport).send(message);
  expect(JSON.parse(String(requests[2]!.body)).Content.Simple.Body.Html.Data).toBe(message.html);
  expect((requests[2]!.headers as Record<string, string>).authorization).toContain("x-amz-security-token");
  for (const status of [400, 429, 500]) {
    const ses = new SesEmail({ region: "us-east-1", accessKey: "fixture", secretKey: "fixture", from: "sender@example.test" }, (async () => new Response("private provider details", { status })) as unknown as typeof fetch);
    let error: unknown; try { await ses.send(message); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(DeliveryError); expect((error as DeliveryError).retryable).toBe(status === 429);
    expect(String(error)).not.toContain("private");
  }
});

// SQL is exercised against PostgreSQL in emailCaptcha.integration.test.ts. This
// fixture isolates encryption, delivery retries and ack/crash behavior.
function queueFixture(sender: TransactionalEmail) {
  const statements: string[] = [];
  let row: { id: string; payload: string | null; retrySafe: boolean; attempts: number; status: string } | undefined;
  let ackFailure = false;
  const db: any = {
    $transaction: async (work: (tx: unknown) => unknown) => work(db),
    $queryRaw: async (parts: TemplateStringsArray, ...values: any[]) => {
      const sql = parts.join("?"); statements.push(sql);
      if (sql.startsWith("SELECT id FROM")) return [{ id: "fixture-user" }];
      if (sql.includes("WITH candidate")) {
        if (!row || row.status !== "pending") return [];
        row.status = "sending"; row.attempts++; return [{ ...row }];
      }
      return [];
    },
    $executeRaw: async (parts: TemplateStringsArray, ...values: any[]) => {
      const sql = parts.join("?"); statements.push(sql);
      if (sql.startsWith("INSERT INTO")) row = { id: values[0], payload: values[2], retrySafe: values[4], attempts: 0, status: "pending" };
      if (sql.includes("SET status = ?")) {
        if (ackFailure) throw Error("fixture ack failure");
        row!.status = values[0]; row!.payload = values[1];
      }
      return 1;
    },
  };
  return { queue: new EmailOutbox(db as PrismaClient, sender, secret, () => {}), db, row: () => row!, statements, failAck: () => { ackFailure = true; } };
}

test("outbox encrypts links, persists before send, wipes success and never retries an acked send", async () => {
  const keys: string[] = [];
  const f = queueFixture({ retrySafe: true, send: async (_message, key) => { keys.push(key!); } });
  await f.queue.enqueue(message, "fixture-user");
  expect(keys).toHaveLength(0); expect(f.row().payload).not.toContain("fixture&");
  expect(f.row().payload).not.toContain(message.to);
  expect(JSON.parse(await symmetricDecrypt({ key: secret, data: f.row().payload! }))).toEqual(message);
  await f.queue.drain(); await f.queue.drain();
  expect(f.statements).toContain('DELETE FROM "Verification" WHERE "expiresAt" <= now()');
  expect(keys).toEqual([f.row().id]); expect(f.row().payload).toBeNull(); expect(f.row().status).toBe("sent");
});

test("outbox bounds retry attempts with stable keys and refuses ambiguous SES retries", async () => {
  const keys: string[] = [];
  const f = queueFixture({ retrySafe: true, send: async (_message, key) => { keys.push(key!); throw Error("fixture network timeout"); } });
  await f.queue.enqueue(message, "fixture-user"); await f.queue.drain();
  expect(keys).toHaveLength(5); expect(new Set(keys).size).toBe(1); expect(f.row().status).toBe("uncertain"); expect(f.row().payload).toBeNull();
  let calls = 0;
  const ses = queueFixture({ send: async () => { calls++; throw Error("ambiguous SES timeout"); } });
  await ses.queue.enqueue(message, "fixture-user"); await ses.queue.drain(); await ses.queue.drain();
  expect(calls).toBe(1); expect(ses.row().status).toBe("uncertain");
  let rejected = 0;
  const throttled = queueFixture({ send: async () => { rejected++; throw new DeliveryError(true); } });
  await throttled.queue.enqueue(message, "fixture-user"); await throttled.queue.drain();
  expect(rejected).toBe(5);
});

test("an accepted SES send with failed database ack is never sent again", async () => {
  let calls = 0;
  const f = queueFixture({ send: async () => { calls++; } });
  await f.queue.enqueue(message, "fixture-user"); f.failAck();
  await expect(f.queue.drain()).rejects.toThrow("fixture ack failure");
  await f.queue.drain(); expect(calls).toBe(1);
  expect(f.statements.some(sql => sql.includes('"retrySafe" = false'))).toBe(true);
});

test("signup response padding applies equally to new and duplicate responses", async () => {
  const waits: number[] = [];
  for (const code of [undefined, "USERNAME_IS_ALREADY_TAKEN", "FAILED_TO_CREATE_USER"]) {
    const handler = accountAuthHandler(async () => code ? Response.json({ code }, { status: 400 }) : Response.json({ user: { id: "must-not-leak" } }), true,
      () => 100, async ms => { waits.push(ms); });
    const response = await handler(new Request("https://api.example.test/api/auth/sign-up/email", { method: "POST", body: JSON.stringify({ password: "fixture-long-password" }) }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: true, message: "If eligible, check your email for the link" });
  }
  expect(waits).toEqual([750, 750, 750]);
});

test("Turnstile rejects HTTP outages and oversized tokens without caching success", async () => {
  let calls = 0;
  const challenge = new Turnstile("fixture", ["app.example.test"], (async () => { calls++; return calls === 1 ? Response.json({ success: true, hostname: "app.example.test", action: "signup" }) : new Response(null, { status: 503 }); }) as unknown as typeof fetch);
  expect(await challenge.verify("same-token", "signup")).toBe(true);
  expect(await challenge.verify("same-token", "signup")).toBe(false);
  expect(await challenge.verify("x".repeat(2049), "signup")).toBe(false); expect(calls).toBe(2);
});
