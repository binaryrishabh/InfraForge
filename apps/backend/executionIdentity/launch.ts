import { relative, resolve } from "node:path";
// Closed launch contract: additional conditions, preloads, defines and plugins are refused.
export const launchContract = { runtime: "bun-1.3.14", target: "bun", conditions: ["bun", "node", "import", "require", "default"], preloads: [], envFiles: false, hosts: ["apps/backend/index.ts", "apps/backend/worker.ts", "apps/backend/ws-server.ts", "apps/backend/internalModel2/sandboxChild.ts", "apps/backend/executionIdentity/launcher.ts"], metadata: ["scripts/boundaries.ts", "scripts/check-boundaries.ts", "scripts/connected-lineage.ts", "scripts/connected-proof-negative.ts", "scripts/deploy/backend.ts", "scripts/deploy/preflight.ts", "scripts/execution-capabilities.ts", "scripts/execution-identity.ts", "scripts/execution-resolution.ts", "scripts/landing-sample.ts", "scripts/lesson-endpoint-lineage.ts", "scripts/lesson-host/cli.ts", "scripts/lesson-host/collect.ts", "scripts/lesson-host/command.ts", "scripts/lesson-host/endpoint.test.ts", "scripts/lesson-host/fixture.ts", "scripts/lesson-host/host.test.ts", "scripts/lesson-host/identity.ts", "scripts/lesson-host/policy.ts", "scripts/lesson-host/probe.test.ts", "scripts/lesson-host/probeSandbox.ts", "scripts/m2l-inventory.ts", "scripts/m2m-inventory.ts", "scripts/m2m-lineage.ts", "scripts/m2m-proof-negative.ts", "scripts/metering-lineage.ts", "scripts/reality/artifacts.ts", "scripts/reality/async-calibration.ts", "scripts/reality/async-performance.ts", "scripts/reality/async-proofs.ts", "scripts/reality/classify.ts", "scripts/reality/compute-calibration.ts", "scripts/reality/compute-performance.ts", "scripts/reality/compute-proofs.ts", "scripts/reality/data-calibration.ts", "scripts/reality/data-performance.ts", "scripts/reality/data-proofs.ts", "scripts/reality/inventory.ts", "scripts/reality/measure-compute.ts", "scripts/reality/metering-performance.ts", "scripts/reality/metering-proofs.ts", "scripts/reality/metering-source.ts", "scripts/reality/network-calibration.ts", "scripts/reality/network-performance.ts", "scripts/reality/network-proofs.ts", "scripts/reality/product-artifacts.ts", "scripts/reality/product-cases.ts", "scripts/reality/product-ledger.ts", "scripts/reality/product-performance.ts", "scripts/reality/product-proofs.ts", "scripts/reality/product-source.ts", "scripts/reality/provider-performance.ts", "scripts/reality/provider-proofs.ts", "scripts/reality/provider-source.ts", "scripts/reality/scan.ts", "scripts/reality/shipping-inventory.ts", "scripts/reality/shipping-taxonomy.ts", "scripts/reality/source-lineage.ts", "scripts/reality/systems-calibration.ts", "scripts/reality/systems-invariants.ts", "scripts/reality/systems-performance.ts", "scripts/reality/systems-proofs.ts", "scripts/reality/trace-input.ts", "scripts/reality/workload-calibration.ts", "scripts/reality/workload-performance.ts", "scripts/reality/workload-proof.ts", "scripts/release.ts", "scripts/release/backup.ts", "scripts/release/compose.ts", "scripts/release/cutover-proof.ts", "scripts/release/external-rehearse.ts", "scripts/release/frontend-check.ts", "scripts/release/neon.ts", "scripts/release/process.ts", "scripts/release/public-check.ts", "scripts/release/rehearse.ts", "scripts/release/sequence.ts", "scripts/release/worker-recovery.ts", "scripts/review-analytics-lock.ts", "scripts/tests/fixtures/execution-launch-probe.ts", "scripts/verify-connected-proof.ts", "scripts/verify-internal-model2-proof.ts", "scripts/verify-model2-lesson-proof.ts", "scripts/verify-model2-workspace-proof.ts"] };
const root = resolve(import.meta.dir, "../../..");
export function activeEntrypoint() { return relative(root, resolve(Bun.main)).replaceAll("\\", "/"); }
export function assertExecutionHost() {
  verifyLaunch();
  const main = activeEntrypoint();
  if (main !== "apps/backend/worker.ts" && !(main === "apps/backend/executionIdentity/launcher.ts" && process.argv[2] === "worker")) throw Error("Unreviewed Model-2 execution host");
}
export function verifyLaunch(args = process.execArgv, env = process.env) {
  if (`bun-${Bun.version}` !== launchContract.runtime) throw Error("Unsupported execution runtime");
  if (["BUN_OPTIONS", "NODE_OPTIONS", "BUN_PRELOAD"].some(key => env[key])) throw Error("Unreviewed execution launch environment");
  if (!args.includes("--no-env-file")) throw Error("Execution requires --no-env-file");
  const main = activeEntrypoint();
  const test = /^(apps|packages|scripts)\/.+\.test\.[cm]?[jt]sx?$/.test(main) || (env.INTEGRATION_RUN === "1" || env.M2M_RUN === "1") && env.INTEGRATION_DISPOSABLE === "local-only";
  if (!launchContract.hosts.includes(main) && !launchContract.metadata.includes(main) && !test) throw Error("Unreviewed execution entrypoint");
  if (launchContract.hosts.includes(main) && !["", "apps/backend"].includes(relative(root, process.cwd()).replaceAll("\\", "/"))) throw Error("Unreviewed execution working directory");
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (["--no-env-file", "--no-install", "--bun", "--watch"].includes(arg)) continue;
    throw Error(`Unreviewed execution launch option: ${arg.split("=")[0]}`);
  }
}
verifyLaunch();

