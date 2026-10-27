import { randomUUID } from "node:crypto";
import { symmetricEncrypt } from "better-auth/crypto";
import type { PrismaClient } from "../lib/generated/prisma/client";
import { DeliveryError, type TransactionalEmail } from "./email";
import {
  prepareMailIntent, renderMailIntent,
  type MailIntent, type MailKind, type MailRequests, type MailSettings,
} from "./mailIntent";

type ClaimedMail = MailIntent & { attempts: number; retrySafe: boolean };
export const MAIL_REQUEST_ATTEMPTS = 5;

export class AccountEmailRequests implements MailRequests {
  constructor(
    private db: PrismaClient,
    private sender: TransactionalEmail,
    private settings: MailSettings,
    private failed = () => console.error("Transactional email delivery failed"),
  ) {}

  async admit(kind: MailKind, email: string, callbackURL: string, handoffHash?: string) {
    // No membership reads, username, password, challenge token or bearer link.
    const payload = await symmetricEncrypt({
      key: this.settings.secret,
      data: JSON.stringify({ email, callbackURL, ...(kind === "signup" && handoffHash ? { handoffHash } : {}) }),
    });
    await this.db.accountMailIntent.create({ data: {
      id: randomUUID(), kind, payload, availableAt: new Date(),
      expiresAt: new Date(Date.now() + (kind === "magic" ? 900_000 : kind === "otp" ? 600_000 : 1800_000)),
      retrySafe: this.sender.retrySafe === true,
    } });
  }

  private async prepareOne() {
    return this.db.$transaction(async tx => {
      const pending = await tx.$queryRaw<MailIntent[]>`
        SELECT id, kind, payload, "expiresAt" FROM "AccountMailIntent"
        WHERE status = 'pending'
            AND "expiresAt" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
        ORDER BY "availableAt", id FOR UPDATE SKIP LOCKED LIMIT 1`;
      const row = pending[0];
      if (!row) return false;
      const prepared = await prepareMailIntent(tx, row, this.settings);
      await tx.accountMailIntent.update({ where: { id: row.id }, data: {
        status: prepared ? "ready" : "sent",
        payload: prepared?.payload ?? null,
        userId: prepared?.userId ?? null,
      } });
      return true;
    });
  }

  async drain() {
    await this.db.$executeRaw`DELETE FROM "AccountMailIntent"
      WHERE "expiresAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')`;
    await this.db.$executeRaw`DELETE FROM "AccountEmailToken"
      WHERE "expiresAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')`;
    await this.db.$executeRaw`DELETE FROM "Verification"
      WHERE "expiresAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')`;
    for (let n = 0; n < 16 && await this.prepareOne(); n++) { /* bounded preparation */ }

    await this.db.$executeRaw`UPDATE "AccountMailIntent" SET status = 'uncertain', payload = NULL
      WHERE status = 'sending' AND "retrySafe" = false AND "availableAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')`;
    for (let n = 0; n < 16; n++) {
      const rows = await this.db.$queryRaw<ClaimedMail[]>`
        WITH candidate AS (SELECT id FROM "AccountMailIntent"
          WHERE (status = 'ready' OR (status = 'sending' AND "retrySafe" = true))
            AND "availableAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
            AND "expiresAt" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AND attempts < ${MAIL_REQUEST_ATTEMPTS}
          ORDER BY "availableAt", id FOR UPDATE SKIP LOCKED LIMIT 1)
        UPDATE "AccountMailIntent" m SET status = 'sending', attempts = attempts + 1,
          "availableAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + interval '30 seconds'
        FROM candidate c WHERE m.id = c.id
        RETURNING m.id, m.kind, m.payload, m."expiresAt", m.attempts, m."retrySafe"`;
      const row = rows[0];
      if (!row) break;
      let retry = false;
      let sent = false;
      try {
        if (row.retrySafe && !this.sender.retrySafe) throw new DeliveryError();
        await this.sender.send(await renderMailIntent(row, this.settings), row.id);
        sent = true;
      } catch (error) {
        const idempotentRetry = row.retrySafe && this.sender.retrySafe === true;
        const explicitRejection = error instanceof DeliveryError && error.retryable;
        retry = row.attempts < MAIL_REQUEST_ATTEMPTS && (idempotentRetry || explicitRejection);
        if (!retry) this.failed();
      }
      await this.db.accountMailIntent.update({ where: { id: row.id }, data: {
        status: sent ? "sent" : retry ? "ready" : "uncertain",
        payload: retry ? row.payload : null,
        availableAt: new Date(Date.now() + Math.min(300, 5 * 2 ** row.attempts) * 1000),
      } });
    }
    await this.db.$executeRaw`UPDATE "AccountMailIntent" SET status = 'uncertain', payload = NULL
      WHERE attempts >= ${MAIL_REQUEST_ATTEMPTS} AND status = 'sending'
        AND "availableAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')`;
  }

  start() {
    let stopping = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
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

// Retire old plaintext reset identifiers and the legacy encrypted-link queue
// before opening HTTP. Existing links must be requested again. The new queue
// persists only request metadata; native reset redemption still uses hashes.
export async function retireLegacyResetStorage(db: PrismaClient) {
  await db.$transaction(async tx => {
    await tx.$executeRaw`DELETE FROM "Verification"
      WHERE identifier LIKE 'reset-password:%'`;
    await tx.$executeRaw`DELETE FROM "AccountMailOutbox"`;
  });
}
