import { randomUUID } from "node:crypto";
import { symmetricEncrypt, symmetricDecrypt } from "better-auth/crypto";
import type { PrismaClient } from "../lib/generated/prisma/client";
import { DeliveryError, type TransactionalEmail, type TransactionalMessage } from "./email";
import { registerVerification } from "./verification";

export interface AccountMailQueue {
  enqueue(message: TransactionalMessage, userId: string, verificationToken?: string): Promise<void>;
}
type Entry = { id: string; payload: string; attempts: number; retrySafe: boolean };
export const MAIL_ATTEMPTS = 5;
// Separate from the simulator's domain-specific BullMQ outbox: encrypted bearer
// links, expiry and provider-specific ambiguity need different delivery semantics.
export class EmailOutbox implements AccountMailQueue {
  constructor(private db: PrismaClient, private sender: TransactionalEmail, private secret: string,
    private failed = () => console.error("Transactional email delivery failed")) {}
  async enqueue(message: TransactionalMessage, userId: string, verificationToken?: string) {
    const id = randomUUID(), expiresAt = new Date(Date.now() + 1800_000);
    const payload = await symmetricEncrypt({ key: this.secret, data: JSON.stringify(message) });
    await this.db.$transaction(async tx => {
      // Serialize insertion with account erasure, including reset emails.
      const live = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "User" WHERE id = ${userId} AND "deletedAt" IS NULL FOR SHARE`;
      if (live.length !== 1) throw Error("Account unavailable");
      if (verificationToken) await registerVerification(tx as PrismaClient, verificationToken, userId);
      await tx.$executeRaw`INSERT INTO "AccountMailOutbox" (id, "userId", payload, "expiresAt", "retrySafe")
        VALUES (${id}, ${userId}, ${payload}, ${expiresAt}, ${this.sender.retrySafe === true})`;
    });
  }
  async drain() {
    // Also clear abandoned, expired links. Never keep plaintext tokens at rest.
    await this.db.$executeRaw`DELETE FROM "AccountMailOutbox" WHERE "expiresAt" <= now()`;
    await this.db.$executeRaw`DELETE FROM "AccountEmailToken" WHERE "expiresAt" <= now()`;
    await this.db.$executeRaw`DELETE FROM "Verification" WHERE "expiresAt" <= now() AND identifier LIKE 'reset-password:%'`;
    // A crashed SES sender may have sent. Wipe it rather than duplicate mail.
    await this.db.$executeRaw`UPDATE "AccountMailOutbox" SET status = 'uncertain', payload = NULL
      WHERE status = 'sending' AND "retrySafe" = false AND "availableAt" <= now()`;
    for (let n = 0; n < 16; n++) {
      const rows = await this.db.$queryRaw<Entry[]>`
        WITH candidate AS (SELECT id FROM "AccountMailOutbox"
          WHERE (status = 'pending' OR (status = 'sending' AND "retrySafe" = true))
            AND "availableAt" <= now() AND "expiresAt" > now() AND attempts < ${MAIL_ATTEMPTS}
          ORDER BY "availableAt", id FOR UPDATE SKIP LOCKED LIMIT 1)
        UPDATE "AccountMailOutbox" m SET status = 'sending', attempts = attempts + 1,
          "availableAt" = now() + interval '30 seconds'
        FROM candidate c WHERE m.id = c.id RETURNING m.id, m.payload, m.attempts, m."retrySafe"`;
      const row = rows[0];
      if (!row) break;
      let retry = false, sent = false;
      try {
        if (row.retrySafe && !this.sender.retrySafe) throw new DeliveryError();
        const message = JSON.parse(await symmetricDecrypt({ key: this.secret, data: row.payload })) as TransactionalMessage;
        await this.sender.send(message, row.id);
        sent = true;
      } catch (error) {
        retry = row.attempts < MAIL_ATTEMPTS && (row.retrySafe && this.sender.retrySafe === true || error instanceof DeliveryError && error.retryable);
        if (!retry) this.failed();
      }
      // If this update fails, the durable claim prevents SES re-send; Resend
      // recovers with the identical idempotency key well inside its 24h window.
      const status = sent ? "sent" : retry ? "pending" : "uncertain";
      const payload = retry ? row.payload : null;
      await this.db.$executeRaw`UPDATE "AccountMailOutbox" SET status = ${status}, payload = ${payload},
        "availableAt" = now() + (${Math.min(300, 5 * 2 ** row.attempts)} * interval '1 second') WHERE id = ${row.id}`;
    }
    // Exhausted crash recovery cannot leave a bearer link indefinitely queued.
    await this.db.$executeRaw`UPDATE "AccountMailOutbox" SET status = 'uncertain', payload = NULL
      WHERE attempts >= ${MAIL_ATTEMPTS} AND status = 'sending' AND "availableAt" <= now()`;
  }
  start() {
    let stopping = false, timer: ReturnType<typeof setTimeout> | undefined;
    let pending: Promise<void> = Promise.resolve();
    const poll = () => {
      pending = this.drain().catch(() => this.failed()).finally(() => {
        if (!stopping) timer = setTimeout(poll, 5000);
      });
    };
    poll();
    return async () => { stopping = true; clearTimeout(timer); await pending; };
  }
}
