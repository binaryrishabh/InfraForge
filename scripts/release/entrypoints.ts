import { readFileSync } from "node:fs";
import { command } from "./process";

interface Service { working_dir: string; command: string[] }
// Compose ships a closed launcher plus one role argument. A Bun flag must never
// become a filename, and bundling the launcher alone must not hide a wrong role.
export function composeEntrypoints(config: { services: Record<string, Service> }) {
  const hosts = { api: ["api", "index.ts"], worker: ["worker", "worker.ts"], "ws-server": ["ws", "ws-server.ts"] };
  return Object.entries(hosts).map(([service, [role, host]]) => {
    const selected = config.services[service];
    if (!selected || selected.working_dir !== "/app/apps/backend" ||
        JSON.stringify(selected.command) !== JSON.stringify(["bun", "--no-env-file", "--no-install", "executionIdentity/launcher.ts", role])) {
      throw Error(`Unreviewed Compose execution command: ${service}`);
    }
    return { service, workdir: selected.working_dir, entrypoints: ["executionIdentity/launcher.ts", host!] };
  });
}

if (import.meta.main) {
  const [configPath, image] = process.argv.slice(2);
  if (!configPath || !image || process.argv.length !== 4) throw Error("Expected Compose JSON and local image");
  for (const { service, workdir, entrypoints } of composeEntrypoints(JSON.parse(readFileSync(configPath, "utf8")))) {
    await command(["docker", "run", "--rm", "--network", "none", "--workdir", workdir, image, "bun", "build", ...entrypoints, "--target=bun", "--outdir=/tmp/entrypoints"], process.cwd(), process.env);
    console.info(`Bundled Compose ${service}: ${entrypoints.join(", ")}`);
  }
  for (const entrypoint of ["scripts/recover-ownership.ts", "cutover/cli.ts", "firstStack/verifierHost.ts", "release/firstStackOperations.ts"]) {
    await command(["docker", "run", "--rm", "--network", "none", "--workdir", "/app/apps/backend", image, "bun", "build", entrypoint, "--target=bun", "--outdir=/tmp/entrypoints"], process.cwd(), process.env);
    console.info(`Bundled ${entrypoint}`);
  }
}
