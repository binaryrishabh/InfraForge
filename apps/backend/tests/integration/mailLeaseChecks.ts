import assert from "node:assert/strict";
import { expect } from "bun:test";
import type { PrismaClient } from "../../lib/generated/prisma/client";
import { AccountEmailRequests } from "../../auth/mailRequests";
import { DeliveryError, FakeEmail, SesEmail } from "../../auth/email";
import type { MailSettings } from "../../auth/mailIntent";

// Every eligibility/lease predicate is evaluated by PostgreSQL. Only the
// provider and a single failed acknowledgement are injected.
async function sesLostAck(db: PrismaClient, settings: MailSettings, unsafe: boolean) {
  await db.accountMailIntent.deleteMany();
  let calls = 0;
  const sender = new SesEmail({ region: "us-east-1", accessKey: "fixture",
    secretKey: "fixture", from: "sender@example.test" }, (async () => {
    calls++; return Response.json({});
  }) as unknown as typeof fetch);
  let loseAck = true;
  const wrapped = new Proxy(db, { get(client, key) {
    if (key === "accountMailIntent") return new Proxy(client.accountMailIntent, { get(model, operation) {
      if (operation === "update") return async (args: any) => {
        if (loseAck && args.data.status === "sent") { loseAck = false; throw Error("fixture lost ack"); }
        return model.update(args);
      };
      return Reflect.get(model, operation);
    } });
    if (unsafe && key === "$queryRaw") return (parts: TemplateStringsArray, ...values: unknown[]) => {
      const changed = parts.map(part => part
        .replace(`(status = 'ready' OR (status = 'sending' AND "retrySafe" = true))`,
          `(status = 'ready' OR status = 'sending')`)
        .replace(/AND "availableAt" <= \(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'\)\s+AND/, "AND"));
      return client.$queryRaw(Object.assign(changed, { raw: [...changed] }), ...values);
    };
    return Reflect.get(client, key);
  } });
  const queue = new AccountEmailRequests(wrapped, sender, settings);
  await queue.admit("signup", "ses@example.test", `${settings.origins[0]}/signup`);
  let failure: unknown;
  try { await queue.drain(); } catch (error) { failure = error; }
  expect(String(failure)).toContain("fixture lost ack");
  const sending = await db.accountMailIntent.findFirstOrThrow();
  expect(sending.status).toBe("sending");
  expect(sending.payload).not.toBeNull();
  expect(sending.availableAt.getTime()).toBeGreaterThan(Date.now());
  assert.equal(calls, 1);

  // Restart before expiry: the live lease must remain invisible to claim SQL.
  await new AccountEmailRequests(wrapped, sender, settings).drain();
  assert.equal(calls, 1, "live SES lease must not be reclaimed");
  expect((await db.accountMailIntent.findUniqueOrThrow({ where: { id: sending.id } })).status).toBe("sending");
  await db.accountMailIntent.update({ where: { id: sending.id }, data: { availableAt: new Date(0) } });
  // Restart after expiry: SES cannot deduplicate an ambiguous accepted send.
  await new AccountEmailRequests(wrapped, sender, settings).drain();
  assert.equal(calls, 1, "expired SES lease must be abandoned");
  const terminal = await db.accountMailIntent.findUniqueOrThrow({ where: { id: sending.id } });
  expect(terminal.status).toBe("uncertain");
  expect(terminal.payload).toBeNull();
}

export async function checkSesLeaseAndNegativeControl(db: PrismaClient, settings: MailSettings) {
  await sesLostAck(db, settings, false);
  let detected: unknown;
  try { await sesLostAck(db, settings, true); } catch (error) { detected = error; }
  // The same guard must FAIL when actual PostgreSQL receives the reviewed
  // unsafe predicate; a fake that always hides sending rows cannot pass this.
  expect(detected).toBeInstanceOf(assert.AssertionError);
  expect(String(detected)).toContain("live SES lease must not be reclaimed");
}

export async function checkPreparationAndRetries(db: PrismaClient, settings: MailSettings) {
  await db.accountMailIntent.deleteMany();
  const mail = new FakeEmail();
  const queue = new AccountEmailRequests(db, mail, settings);
  await queue.admit("signup", "rollback@example.test", `${settings.origins[0]}/signup`);
  const pending = await db.accountMailIntent.findFirstOrThrow();
  const broken = new Proxy(db, { get(client, key) {
    if (key === "$transaction") return (work: (tx: any) => Promise<unknown>) => client.$transaction(async tx => {
      await work(tx);
      throw Error("fixture preparation commit failed");
    });
    return Reflect.get(client, key);
  } });
  let failed = false;
  try { await new AccountEmailRequests(broken, mail, settings).drain(); } catch { failed = true; }
  expect(failed).toBe(true);
  expect((await db.accountMailIntent.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("pending");
  expect(await db.verification.count({ where: { id: `mail:${pending.id}` } })).toBe(0);
  expect(mail.messages).toHaveLength(0);
  await new AccountEmailRequests(db, mail, settings).drain();
  expect(mail.messages).toHaveLength(1);
  expect(await db.verification.count({ where: { id: `mail:${pending.id}` } })).toBe(1);

  for (const retrySafe of [false, true]) {
    await db.accountMailIntent.deleteMany();
    const keys: string[] = [];
    const failing = new AccountEmailRequests(db, { retrySafe, send: async (_message, key) => {
      keys.push(key!); throw new DeliveryError(true);
    } }, settings, () => {});
    await failing.admit("signup", "retry@example.test", `${settings.origins[0]}/signup`);
    for (let attempt = 0; attempt < 6; attempt++) {
      await db.accountMailIntent.updateMany({ data: { availableAt: new Date(0) } });
      await failing.drain();
    }
    expect(keys).toHaveLength(5);
    expect(new Set(keys).size).toBe(1);
    const terminal = await db.accountMailIntent.findFirstOrThrow();
    expect(terminal.status).toBe("uncertain");
    expect(terminal.payload).toBeNull();
  }
}
