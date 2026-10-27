import { haveIBeenPwned } from "better-auth/plugins";
import { isPasswordCompromised } from "better-auth/plugins/haveibeenpwned";
import { APIError, createAuthMiddleware } from "better-auth/api";

const compromisedMessage = "This password appeared in a data breach. Choose another.";

// Keep the pinned plugin's path selection and k-anonymity check. Separate the
// check from hashing so only an unavailable breach check can fail open.
export function passwordBreachPolicy() {
  const plugin = haveIBeenPwned({
    customPasswordCompromisedMessage: compromisedMessage,
    paths: ["/sign-up/email", "/change-password", "/set-password"],
  });
  return { ...plugin, hooks: { before: [{
    matcher: (ctx: { path?: string }) => ctx.path === "/reset-password",
    handler: createAuthMiddleware(async ctx => {
      // The pinned reset handler consumes its proof before hashing. Use the
      // plugin's checker before entering that handler so refusals keep the link.
      let compromised = false;
      try { compromised = await isPasswordCompromised(ctx.body.newPassword); }
      catch { console.error("Password breach check unavailable"); }
      if (compromised) throw new APIError("BAD_REQUEST", {
        code: "PASSWORD_COMPROMISED", message: compromisedMessage,
      });
    }),
  }] }, init(ctx: Parameters<typeof plugin.init>[0]) {
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
