// Opt-in Linux systemd proof using the shipped sandbox and real scored subprocess work.
// No containers are created, no production unit is stopped, and no credentials are loaded.
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { chown, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

if (process.platform !== "linux" || process.getuid?.() !== 0 ||
  !process.argv.includes("--allow-disposable-service")) {
  throw Error("Run as root on an owned Linux systemd host with --allow-disposable-service");
}
async function command(args: string[]) {
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [output, error, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  assert.equal(code, 0, error); return output.trim();
}
const uid = await command(["id", "-u", "infraforge-verifier"]);
const gid = await command(["id", "-g", "infraforge-verifier"]);
assert.match(uid, /^[1-9][0-9]*$/); assert.match(gid, /^[1-9][0-9]*$/);
const socket = `/run/user/${uid}/docker.sock`;
const root = fileURLToPath(new URL("../../", import.meta.url));
const template = await readFile(new URL("../../ops/first-stack-verifier.service", import.meta.url), "utf8");
// systemd quoting, not shell interpolation. Percent signs are specifiers in ExecStart.
const quote = (value: string) => JSON.stringify(value.replaceAll("%", "%%"));
for (const phase of ["visible", "hidden-1"]) {
  const name = `infraforge-verifier-proof-${randomUUID()}`;
  const directory = `/run/${name}`, path = `/run/systemd/system/${name}.service`;
  await mkdir(directory, { mode: 0o700 }); await chown(directory, Number(uid), Number(gid));
  let installed = false;
  try {
    await writeFile(`${directory}/stop-phase`, phase, { mode: 0o644 });
    const start = [process.execPath, "--no-env-file", "--no-install",
      fileURLToPath(new URL("./service-stop-fixture.ts", import.meta.url)), "supervisor", directory, phase, socket];
    const unit = template.replaceAll("REPLACE_WITH_UID", uid)
      .replace(/^ConditionPathExists=.*\r?\n/gm, "").replace(/^LoadCredential=.*\r?\n/gm, "")
      .replace(/^WorkingDirectory=.*$/m, `WorkingDirectory=${quote(root)}`)
      .replace(/^ExecStart=.*$/m, `ExecStart=${start.map(quote).join(" ")}\nReadWritePaths=${directory}`);
    await writeFile(path, unit, { mode: 0o644 }); installed = true;
    await command(["systemctl", "daemon-reload"]);
    await command(["systemctl", "start", name]);
    const expires = Date.now() + 120000;
    while (!await Bun.file(`${directory}/active`).exists()) {
      assert.ok(Date.now() < expires, "Scored subprocess never became active");
      assert.equal(await command(["systemctl", "is-active", name]), "active");
      await Bun.sleep(100);
    }
    await command(["systemctl", "stop", name]);
    assert.equal(await command(["systemctl", "show", name, "--property=ExecMainStatus", "--value"]), "0");
    assert.equal(await Bun.file(`${directory}/child-signalled`).exists(), false);
    const result = JSON.parse(await readFile(`${directory}/result.json`, "utf8"));
    assert.equal(result.scored, true); assert.ok(result.hidden > 0);
    console.log(`systemd socket access and scored drain during ${phase}: passed`);
  } finally {
    if (installed) {
      await command(["systemctl", "stop", name]);
      await unlink(path); await command(["systemctl", "daemon-reload"]);
    }
    await rm(directory, { recursive: true, force: true });
  }
}
