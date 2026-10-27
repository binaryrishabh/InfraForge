import { PrismaClient } from "../../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { makeSignature } from "better-auth/crypto";
import { randomBytes } from "node:crypto";
import { createAuth } from "../../auth/createAuth";
import { readAuthSettings } from "../../auth/settings";
import type { LocalHarness } from "./localHarness";

// Creates actual rows through Better Auth's adapter in a guarded disposable DB.
// No production endpoint, test plugin, fake provider or relaxed auth check exists.
export class SessionFixtures {
  readonly prisma: PrismaClient;
  readonly auth: ReturnType<typeof createAuth>;
  private users: string[] = [];
  track(userId: string) { this.users.push(userId); }
  constructor(private readonly harness: LocalHarness) {
    // Keep adapter transactions separate from raw inspection queries, as in the API.
    this.prisma = new PrismaClient({ adapter: new PrismaPg({ ...harness.sql.options }) });
    this.auth = createAuth(this.prisma, readAuthSettings({ NODE_ENV: "test",
      BETTER_AUTH_SECRET: harness.authSecret, BETTER_AUTH_URL: harness.api.replace(/\/api$/, ""), APP_ORIGINS: harness.origin }));
  }
  async create() {
    const context = await this.auth.$context;
    const user = await context.internalAdapter.createUser({ name: "Session fixture", email: `${crypto.randomUUID()}@infraforge.test`, emailVerified: true }, { method: "fixture" });
    this.users.push(user.id);
    return { user, ...await this.sessionFor(user.id) };
  }
  async createCredential() {
    const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
    const response = await fetch(this.harness.api + "/auth/sign-up/email", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: this.harness.origin,
        "X-Forwarded-For": "198.51.100.50" }, body: JSON.stringify({ username: `User_${suffix}`,
        name: "Credential fixture", email: `${suffix}@infraforge.test`, password: randomBytes(24).toString("base64url") + "Aa1!" }),
    });
    if (!response.ok) throw new Error(`Public credential fixture returned ${response.status}`);
    const context = await this.auth.$context;
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith(context.authCookies.sessionToken.name + "="))?.split(";")[0];
    if (!cookie) throw new Error("Credential fixture has no session cookie");
    const result = await this.auth.api.getSession({ headers: new Headers({ Cookie: cookie }) });
    if (!result) throw new Error("Credential fixture has no database session");
    this.track(result.user.id);
    return { ...result, cookie };
  }
  async sessionFor(userId: string) {
    const context = await this.auth.$context;
    const session = await context.internalAdapter.createSession(userId);
    if (!session) throw new Error("Session fixture creation failed");
    const signature = await makeSignature(session.token, this.harness.authSecret);
    return { session, cookie: `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${session.token}.${signature}`)}` };
  }
  async close() {
    // Designs and runs must already be removed; Restrict exposes fixture cleanup bugs.
    await this.prisma.user.deleteMany({ where: { id: { in: this.users } } });
    await this.prisma.$disconnect();
  }
}
