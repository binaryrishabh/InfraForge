import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { symmetricEncrypt } from "better-auth/crypto";
import type { Prisma, PrismaClient } from "../lib/generated/prisma/client";
import { AccountEmailRequests } from "../auth/mailRequests";
import {
  mailCredential, prepareMailIntent, readMailPayload, renderMailIntent, storedIdentifier,
  type MailKind,
} from "../auth/mailIntent";
import { FakeEmail } from "../auth/email";

const settings = {
  secret: "fixture-only-stable-key-at-least-32-characters",
  baseURL: "https://api.example.test", origins: ["https://app.example.test"],
};
async function fixture(kind: MailKind) {
  const rows: any[] = [];
  let membershipReads = 0;
  const db = {
    verification: { create: async ({ data }: any) => { rows.push(data); return data; } },
    $queryRaw: async () => { membershipReads++; return [{ id: "fixture-user", emailVerified: false }]; },
  } as unknown as Prisma.TransactionClient;
  const intent = {
    id: randomUUID(), kind, expiresAt: new Date(Date.now() + 1800_000),
    payload: await symmetricEncrypt({ key: settings.secret, data: JSON.stringify({
      email: "learner@example.test", callbackURL: "https://app.example.test/signup",
    }) }),
  };
  return { db, rows, intent, reads: () => membershipReads };
}

test("reset mail preparation stores only a digest and reconstructs the same transient credential", async () => {
  const f = await fixture("reset");
  const prepared = await prepareMailIntent(f.db, f.intent, settings);
  const token = mailCredential(f.intent, settings.secret);
  expect(f.rows[0].identifier).toBe(storedIdentifier(`reset-password:${token}`));
  expect(f.rows[0].identifier).not.toContain(token);
  expect(JSON.stringify(f.rows)).not.toContain(token);
  expect(await readMailPayload(prepared!.payload, settings.secret)).toEqual({
    email: "learner@example.test", callbackURL: "https://app.example.test/signup",
  });
  const message = await renderMailIntent({ ...f.intent, ...prepared }, settings);
  expect(message.text).toContain(token);
  expect(await renderMailIntent({ ...f.intent, ...prepared }, settings)).toEqual(message);
  expect(mailCredential(f.intent, "different-fixture-key")).not.toBe(token);
  expect(mailCredential({ ...f.intent, kind: "signup" }, settings.secret)).not.toBe(token);
});

test("signup proof preparation never reads account or username membership", async () => {
  const f = await fixture("signup");
  const prepared = await prepareMailIntent(f.db, f.intent, settings);
  expect(f.reads()).toBe(0);
  expect(prepared?.userId).toBeNull();
  expect(f.rows[0].value).toBe("learner@example.test");
  const token = mailCredential(f.intent, settings.secret);
  expect(f.rows[0].identifier).toBe(storedIdentifier(`signup-proof:${token}`));
  expect(JSON.stringify(f.rows)).not.toContain(token);
  expect((await renderMailIntent(f.intent, settings)).text).toContain(`emailProof=${token}`);
});

test("all public mail admission persists intent without membership reads or token material", async () => {
  const intents: any[] = [];
  const db = { accountMailIntent: { create: async ({ data }: any) => { intents.push(data); } } };
  const queue = new AccountEmailRequests(db as unknown as PrismaClient, new FakeEmail(), settings);
  for (const kind of ["signup", "reset", "verify"] as const) {
    await queue.admit(kind, "absent@example.test", "https://app.example.test/callback");
    const row = intents.at(-1);
    const metadata = await readMailPayload(row.payload, settings.secret);
    expect(Object.keys(metadata).sort()).toEqual(["callbackURL", "email"]);
    expect(row.status).toBeUndefined(); // Database defaults to pending.
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(1790_000);
  }
  expect(intents).toHaveLength(3);
  db.accountMailIntent.create = async () => { throw Error("fixture admission unavailable"); };
  await expect(queue.admit("reset", "present@example.test", "")).rejects.toThrow("admission unavailable");
});
