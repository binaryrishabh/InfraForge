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
  const provider = (name: string) => {
    const clientId = env[`${name}_CLIENT_ID`];
    const clientSecret = env[`${name}_CLIENT_SECRET`];
    if (!!clientId !== !!clientSecret) throw new Error(`${name} requires both client ID and secret`);
    return clientId && clientSecret ? { clientId, clientSecret } : undefined;
  };
  const google = provider("GOOGLE");
  const github = provider("GITHUB");
  return { baseURL, origins, secret: env.BETTER_AUTH_SECRET, secure: new URL(baseURL).protocol === "https:",
    socialProviders: { ...(google ? { google } : {}), ...(github ? { github } : {}) } };
}
