import { expect, test } from "bun:test";

test.skipIf(process.env.HARDENING_SERVICES !== "owned-local")("real subscribeToDeployment waits for Redis readiness and disconnects on abort or failure", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", `${import.meta.dir}/fixtures/hardeningSubscription.ts`], {
    env: { PATH: process.env.PATH ?? "" }, stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 12000);
  try {
    const [output, diagnostic] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ exit: await child.exited, proof: output.includes("SUBSCRIPTION PROOF PASS") }).toEqual({ exit: 0, proof: true });
    expect(diagnostic).not.toContain("Unhandled");
    expect(output).toContain("SUBSCRIPTION PROOF PASS");
  } finally { clearTimeout(timer); child.kill("SIGKILL"); await child.exited; }
}, 15000);
