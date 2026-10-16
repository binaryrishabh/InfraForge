import { spawn } from "node:child_process";
// No shell, inherited credentials, endpoint overrides or unbounded command output.
export async function command(file: string, args: string[], userService = false) {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? process.env.Path, HOME: process.env.HOME };
  if (userService) for (const key of ["XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"]) if (process.env[key]) env[key] = process.env[key];
  const child = spawn(file, args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "", bytes = 0, exceeded = false;
  const timer = setTimeout(() => { exceeded = true; child.kill("SIGKILL"); }, 10000);
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk: Buffer) => {
    bytes += chunk.length; if (bytes > 1048576) { exceeded = true; child.kill("SIGKILL"); }
    else if (stream === child.stdout) output += chunk.toString();
  });
  try {
    const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    if (code !== 0 || exceeded) throw Error("Inspection unavailable");
    return output.trim();
  } finally { clearTimeout(timer); }
}
