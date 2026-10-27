import { haveIBeenPwned } from "better-auth/plugins";
import { APIError } from "better-auth/api";

// Keep the pinned plugin's path selection and k-anonymity check. Separate the
// check from hashing so only an unavailable breach check can fail open.
export function passwordBreachPolicy() {
  const plugin = haveIBeenPwned({
    customPasswordCompromisedMessage: "This password appeared in a data breach. Choose another.",
    paths: ["/sign-up/email", "/reset-password", "/change-password", "/set-password"],
  });
  return { ...plugin, init(ctx: Parameters<typeof plugin.init>[0]) {
    const originalHash = ctx.password.hash;
    const check = plugin.init({ ...ctx, password: { ...ctx.password, hash: async password => password } });
    return { context: { password: { ...ctx.password, async hash(password: string) {
      try { await check.context.password.hash(password); }
      catch (error) {
        if (error instanceof APIError && error.body?.code === "PASSWORD_COMPROMISED") throw error;
        console.error("Password breach check unavailable");
      }
      return originalHash(password);
    } } } };
  } };
}
