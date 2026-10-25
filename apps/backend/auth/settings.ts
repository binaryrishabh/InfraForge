import { readEmail } from "./email";
import { readChallenge } from "./turnstile";
import { HOSTED_LOGIN_ORIGIN, LOGIN_FLAGS } from "./loginMethods";

export function readAuthSettings(env: Record<string, string | undefined>) {
  const production = env.NODE_ENV === "production";
  const origin = (value: string) => {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== value ||
        (production && url.protocol !== "https:") || url.username || url.password || url.hostname.includes("*")) {
      throw new Error("Authentication origins must be exact HTTP(S) origins; production requires HTTPS");
    }
    return url.origin;
  };
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters; no default secret is provided");
  }
  if (!env.BETTER_AUTH_URL || !env.APP_ORIGINS) throw new Error("BETTER_AUTH_URL and APP_ORIGINS are required");
  const baseURL = origin(env.BETTER_AUTH_URL);
  const origins = [...new Set(env.APP_ORIGINS.split(",").map((value) => origin(value.trim())))];
  if (production && [baseURL, ...origins].some((value) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname))) throw new Error("Production requires public authentication origins");
  const provider = (name: string) => {
    const clientId = env[`${name}_CLIENT_ID`];
    const clientSecret = env[`${name}_CLIENT_SECRET`];
    if (!!clientId !== !!clientSecret) throw new Error(`${name} requires both client ID and secret`);
    return clientId && clientSecret ? { clientId, clientSecret } : undefined;
  };
  const google = provider("GOOGLE");
  const github = provider("GITHUB");
  if (env.ACCOUNT_ESSENTIALS_ENABLED && !["true", "false"].includes(env.ACCOUNT_ESSENTIALS_ENABLED)) throw Error("ACCOUNT_ESSENTIALS_ENABLED must be true or false");
  const enabled = env.ACCOUNT_ESSENTIALS_ENABLED === "true";
  for (const name of ["AUTH_EMAIL_ENABLED", "AUTH_EMAIL_VERIFICATION_REQUIRED"]) {
    if (env[name] && !["true", "false"].includes(env[name]!)) throw Error(`${name} must be true or false`);
  }
  const emailEnabled = env.AUTH_EMAIL_ENABLED === "true" || enabled;
  const verificationRequired = env.AUTH_EMAIL_VERIFICATION_REQUIRED !== "false";
  const email = readEmail(env), challenge = readChallenge(env);
  if (emailEnabled && !email) throw Error("Email requires a configured transactional email provider");
  for (const name of LOGIN_FLAGS) {
    if (env[name] && !["true", "false"].includes(env[name]!)) throw Error(`${name} must be true or false`);
  }
  const loginMethods = {
    linking: env.AUTH_ACCOUNT_LINKING_ENABLED === "true", magicLink: env.AUTH_MAGIC_LINK_ENABLED === "true",
    emailOtp: env.AUTH_EMAIL_OTP_ENABLED === "true", settings: env.AUTH_METHOD_SETTINGS_ENABLED === "true",
    hosted: env.AUTH_HOSTED_LOGIN_ENABLED === "true",
  };
  if ((loginMethods.magicLink || loginMethods.emailOtp)
    && (!emailEnabled || env.TRANSACTIONAL_EMAIL_PROVIDER !== "resend" || !challenge)) {
    throw Error("Email login requires enabled email, Resend and Turnstile");
  }
  const returnOrigins = [...origins];
  if (loginMethods.hosted && !origins.includes(HOSTED_LOGIN_ORIGIN)) origins.push(HOSTED_LOGIN_ORIGIN);
  return { baseURL, origins, secret: env.BETTER_AUTH_SECRET, secure: new URL(baseURL).protocol === "https:",
    returnOrigins, loginMethods,
    accountEssentials: { enabled, emailEnabled, verificationRequired, email, challenge, siteKey: env.TURNSTILE_SITE_KEY },
    socialProviders: { ...(google ? { google } : {}), ...(github ? { github } : {}) } };
}
