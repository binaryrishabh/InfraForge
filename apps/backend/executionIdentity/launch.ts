// Closed launch contract: additional conditions, preloads, defines and plugins are refused.
export const launchContract = { runtime: "bun-1.3.14", target: "bun", conditions: ["bun", "node", "import", "require", "default"], preloads: [], envFiles: false };
export function verifyLaunch(args = process.execArgv, env = process.env) {
  if (`bun-${Bun.version}` !== launchContract.runtime) throw Error("Unsupported execution runtime");
  if (["BUN_OPTIONS", "NODE_OPTIONS", "BUN_PRELOAD"].some(key => env[key])) throw Error("Unreviewed execution launch environment");
  if (!args.includes("--no-env-file")) throw Error("Execution requires --no-env-file");
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (["--no-env-file", "--no-install", "--bun", "--watch"].includes(arg)) continue;
    throw Error(`Unreviewed execution launch option: ${arg.split("=")[0]}`);
  }
}
verifyLaunch();

