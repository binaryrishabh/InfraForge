export type ChallengeAction = "signup" | "password_reset" | "email_login" | "email_login_redeem";
export interface SignupChallenge {
  readonly protectReset?: boolean;
  verify(token: string, action: ChallengeAction, ip?: string): Promise<boolean>;
}
export class Turnstile implements SignupChallenge {
  constructor(private secret: string, private hostnames: string[],
    private transport: typeof fetch = fetch, readonly protectReset = true) {}
  async verify(token: string, action: ChallengeAction, ip?: string) {
    if (!token || token.length > 2048) return false;
    try {
      const response = await this.transport("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body: new URLSearchParams({ secret: this.secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
        signal: AbortSignal.timeout(5000), redirect: "error",
      });
      if (!response.ok) return false;
      const result = await response.json() as { success?: boolean; hostname?: string; action?: string };
      return result.success === true && result.action === action && this.hostnames.includes(result.hostname ?? "");
    } catch { return false; }
  }
}
export class FakeChallenge implements SignupChallenge {
  readonly calls: Array<{ token: string; action: ChallengeAction }> = [];
  constructor(public accepted = true) {}
  async verify(token: string, action: ChallengeAction) { this.calls.push({ token, action }); return this.accepted; }
}
export function readChallenge(env: Record<string, string | undefined>): SignupChallenge | undefined {
  const flags = ["TURNSTILE_ENABLED", "TURNSTILE_DEV_BYPASS", "TURNSTILE_PROTECT_RESET"] as const;
  for (const name of flags) {
    const value = env[name];
    if (value && !["true", "false"].includes(value)) throw Error(`${name} must be true or false`);
  }
  if (env.TURNSTILE_DEV_BYPASS === "true") {
    if (!["development", "test"].includes(env.NODE_ENV ?? "")) {
      throw Error("Turnstile bypass requires development or test mode");
    }
    return new FakeChallenge();
  }
  if (env.TURNSTILE_ENABLED === "false") return undefined;
  const configured = env.TURNSTILE_SECRET_KEY || env.TURNSTILE_HOSTNAMES || env.TURNSTILE_SITE_KEY;
  if (env.TURNSTILE_ENABLED !== "true" && !configured) return undefined;
  if (!env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_SITE_KEY || !env.TURNSTILE_HOSTNAMES) {
    throw Error("Turnstile requires secret, site key and hostnames");
  }
  const hosts = env.TURNSTILE_HOSTNAMES.split(",").map(h => h.trim());
  if (hosts.some(h => !/^[a-z0-9.-]+$/.test(h) || h.includes(".."))) throw Error("Turnstile requires exact hostnames");
  return new Turnstile(env.TURNSTILE_SECRET_KEY, hosts, fetch, env.TURNSTILE_PROTECT_RESET !== "false");
}
