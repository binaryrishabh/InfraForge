import { exactOrigin, fullSha } from "../release/public-check";
export function deploymentSettings(env: Record<string, string | undefined>) {
  const required = ["EC2_HOST", "EC2_USERNAME", "EC2_SSH_KEY", "EC2_HOST_FINGERPRINT", "VERCEL_TOKEN",
    "VERCEL_ORG_ID", "VERCEL_PROJECT_ID", "RELEASE_SHA", "BACKEND_ORIGIN", "FRONTEND_ORIGIN"];
  const missing = required.filter(name => !env[name]?.trim());
  if (missing.length) throw new Error(`Missing release settings: ${missing.join(", ")}`);
  if (!/^SHA256:[A-Za-z0-9+/]{43}=?$/.test(env.EC2_HOST_FINGERPRINT!)) throw new Error("Pinned SHA256 SSH fingerprint required");
  fullSha(env.RELEASE_SHA!);
  exactOrigin(env.BACKEND_ORIGIN!);
  exactOrigin(env.FRONTEND_ORIGIN!);
}
if (import.meta.main) { deploymentSettings(process.env); console.log("Release setting names and formats verified"); }
