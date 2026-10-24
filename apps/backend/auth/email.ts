import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type TransactionalMessage = { to: string; subject: string; text: string; html?: string; sensitive?: boolean };
export interface TransactionalEmail {
  readonly retrySafe?: boolean;
  send(message: TransactionalMessage, idempotencyKey?: string): Promise<void>;
}
export class DeliveryError extends Error {
  constructor(readonly retryable = false) { super("Transactional email delivery failed"); }
}
type Transport = typeof fetch;
const failure = () => new DeliveryError();

export class ResendEmail implements TransactionalEmail {
  readonly retrySafe = true;
  constructor(private key: string, private from: string, private transport: Transport = fetch) {}
  async send(message: TransactionalMessage, idempotencyKey?: string) {
    try {
      const response = await this.transport("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
        body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
        signal: AbortSignal.timeout(5000), redirect: "error",
      });
      if (!response.ok) throw failure();
      await response.body?.cancel();
    } catch { throw failure(); } // Provider exceptions/bodies can contain recipients and credentials.
  }
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const hmac = (key: string | Buffer, value: string) => createHmac("sha256", key).update(value).digest();
// SES v2 SendEmail, AWS Signature Version 4, commercial AWS regions only.
export class SesEmail implements TransactionalEmail {
  constructor(private config: { region: string; accessKey: string; secretKey: string; sessionToken?: string; from: string },
    private transport: Transport = fetch, private now = () => new Date()) {}
  async send(message: TransactionalMessage) {
    try {
      const c = this.config, host = `email.${c.region}.amazonaws.com`, path = "/v2/email/outbound-emails";
      const body = JSON.stringify({ FromEmailAddress: c.from, Destination: { ToAddresses: [message.to] },
        Content: { Simple: { Subject: { Data: message.subject, Charset: "UTF-8" },
          Body: { Text: { Data: message.text, Charset: "UTF-8" },
            ...(message.html ? { Html: { Data: message.html, Charset: "UTF-8" } } : {}) } } } });
      const date = this.now().toISOString().replace(/[:-]|\.\d{3}/g, ""), day = date.slice(0, 8);
      const headers: Record<string, string> = { "content-type": "application/json", host, "x-amz-date": date,
        ...(c.sessionToken ? { "x-amz-security-token": c.sessionToken } : {}) };
      const names = Object.keys(headers).sort(), signed = names.join(";");
      const canonical = ["POST", path, "", names.map(n => `${n}:${headers[n]}\n`).join(""), signed, hash(body)].join("\n");
      const scope = `${day}/${c.region}/ses/aws4_request`;
      const key = hmac(hmac(hmac(hmac(`AWS4${c.secretKey}`, day), c.region), "ses"), "aws4_request");
      headers.authorization = `AWS4-HMAC-SHA256 Credential=${c.accessKey}/${scope}, SignedHeaders=${signed}, Signature=${hmac(key, `AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`).toString("hex")}`;
      const response = await this.transport(`https://${host}${path}`, { method: "POST", headers, body,
        signal: AbortSignal.timeout(5000), redirect: "error" });
      if (!response.ok) {
        // Only an explicit throttle rejection is safe to retry without a
        // provider idempotency key. Network failures/5xx can mean accepted mail.
        await response.body?.cancel();
        throw new DeliveryError(response.status === 429);
      }
      await response.body?.cancel();
    } catch (error) { throw error instanceof DeliveryError ? error : failure(); }
  }
}

// Injection-only fake: never selected by an environment variable.
export class FakeEmail implements TransactionalEmail {
  readonly retrySafe = true;
  readonly messages: TransactionalMessage[] = [];
  async send(message: TransactionalMessage) { this.messages.push({ ...message }); }
}

// Explicit local development only. Exclusive files make retries idempotent.
export class LocalOutboxEmail implements TransactionalEmail {
  readonly retrySafe = true;
  constructor(private directory: string) {}
  async send(message: TransactionalMessage, idempotencyKey: string = randomUUID()) {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(idempotencyKey)) throw failure();
    await mkdir(this.directory, { recursive: true });
    const receipt = message.sensitive
      ? { to: message.to, subject: message.subject, text: "Sensitive link omitted from local storage" } : message;
    try { await writeFile(join(this.directory, `${idempotencyKey}.json`), JSON.stringify(receipt), { flag: "wx", mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw failure(); }
  }
}

export function readEmail(env: Record<string, string | undefined>): TransactionalEmail | undefined {
  const provider = env.TRANSACTIONAL_EMAIL_PROVIDER;
  if (!provider) return undefined;
  if (provider === "local") {
    if (!["development", "test"].includes(env.NODE_ENV ?? "")) throw Error("Local email requires development or test mode");
    return new LocalOutboxEmail(fileURLToPath(new URL("../../../.cache/mail-outbox/", import.meta.url)));
  }
  const required = (name: string) => { const value = env[name]; if (!value?.trim() || /[\r\n]/.test(value)) throw Error(`Missing or invalid ${name}`); return value; };
  const from = required("TRANSACTIONAL_EMAIL_FROM");
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from)) throw Error("TRANSACTIONAL_EMAIL_FROM must be a mailbox");
  if (provider === "resend") return new ResendEmail(required("RESEND_API_KEY"), from);
  if (provider === "ses") {
    const region = required("SES_REGION");
    if (!/^[a-z]{2}-[a-z]+-\d$/.test(region) || region.startsWith("cn-")) throw Error("Unsupported SES region");
    return new SesEmail({ from, region, accessKey: required("SES_ACCESS_KEY_ID"), secretKey: required("SES_SECRET_ACCESS_KEY"),
      sessionToken: env.SES_SESSION_TOKEN || undefined });
  }
  throw Error("TRANSACTIONAL_EMAIL_PROVIDER must be ses, resend or local");
}

// Delivery is outside the request timing path. Bounded work, fixed timeout, no
// request/token/address/body logging. Restarts may drop mail; users can resend.
export function emailDispatcher(email: TransactionalEmail, failed = () => console.error("Transactional email delivery failed")) {
  let pending = 0;
  return (message: TransactionalMessage, beforeSend?: () => Promise<void>) => {
    if (pending >= 32) { failed(); return; }
    pending++;
    void Promise.resolve().then(() => beforeSend?.()).then(() => email.send(message)).catch(() => failed()).finally(() => pending--);
  };
}
