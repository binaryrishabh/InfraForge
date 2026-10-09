import { PrismaClient } from "../../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { makeSignature } from "better-auth/crypto";
import { createAuth } from "../../auth/createAuth";
import { readAuthSettings } from "../../auth/settings";
import type { LocalHarness } from "./localHarness";

// Creates actual rows through Better Auth's adapter in a guarded disposable DB.
// No production endpoint, test plugin, fake provider or relaxed auth check exists.
export class SessionFixtures {
  readonly prisma: PrismaClient;
  readonly auth: ReturnType<typeof createAuth>;
  private users: string[] = [];
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
  async sessionFor(userId: string) {
    const context = await this.auth.$context;
    const session = await context.internalAdapter.createSession(userId);
    if (!session) throw new Error("Session fixture creation failed");
    const signature = await makeSignature(session.token, this.harness.authSecret);
    return { session, cookie: `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${session.token}.${signature}`)}` };
  }
  async close() {
    // Designs must already be removed; Restrict prevents hiding fixture cleanup bugs.
    await this.prisma.user.deleteMany({ where: { id: { in: this.users } } });
    await this.prisma.$disconnect();
  }
}
