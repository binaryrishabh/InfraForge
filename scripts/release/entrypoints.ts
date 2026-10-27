import { readFileSync } from "node:fs";
import { command } from "./process";

interface Service { working_dir: string; command: string[] }
// Each Compose service starts exactly its own host file. A Bun flag must never become a filename.
export function composeEntrypoints(config: { services: Record<string, Service> }) {
  const hosts = { api: "index.ts", worker: "worker.ts", "ws-server": "ws-server.ts" };
  return Object.entries(hosts).map(([service, host]) => {
    const selected = config.services[service];
    if (!selected || selected.working_dir !== "/app/apps/backend" ||
        JSON.stringify(selected.command) !== JSON.stringify(["bun", "--no-env-file", "--no-install", host])) {
      throw Error(`Unreviewed Compose execution command: ${service}`);
    }
    return { service, workdir: selected.working_dir, entrypoints: [host] };
  });
}

if (import.meta.main) {
  const [configPath, image] = process.argv.slice(2);
  if (!configPath || !image || process.argv.length !== 4) throw Error("Expected Compose JSON and local image");
  for (const { service, workdir, entrypoints } of composeEntrypoints(JSON.parse(readFileSync(configPath, "utf8")))) {
    await command(["docker", "run", "--rm", "--network", "none", "--workdir", workdir, image, "bun", "build", ...entrypoints, "--target=bun", "--outdir=/tmp/entrypoints"], process.cwd(), process.env);
    console.info(`Bundled Compose ${service}: ${entrypoints.join(", ")}`);
  }
  for (const entrypoint of ["scripts/recover-ownership.ts", "cutover/cli.ts"]) {
    await command(["docker", "run", "--rm", "--network", "none", "--workdir", "/app/apps/backend", image, "bun", "build", entrypoint, "--target=bun", "--outdir=/tmp/entrypoints"], process.cwd(), process.env);
    console.info(`Bundled ${entrypoint}`);
  }
}
