import { command } from "./process";

let ownedBuilder: string | undefined;
let cleaning: Promise<void> | undefined;
export async function cleanupReleaseBuilder(run = command, root = process.cwd()) {
  if (!ownedBuilder) return;
  if (!cleaning) cleaning = run(["docker", "buildx", "rm", "--force", ownedBuilder], root).then(() => { ownedBuilder = undefined; }).finally(() => { cleaning = undefined; });
  await cleaning;
}

// A dedicated BuildKit cgroup includes build steps. docker build --memory is
// ignored by BuildKit; never change the operator's selected/default builder.
export async function buildReleaseImage(sha: string, image: string, root: string, run = command) {
  const builder = `infraforge-release-${sha.slice(0, 12)}-${process.pid}`;
  await run(["docker", "buildx", "create", "--name", builder, "--driver", "docker-container",
    "--driver-opt", "memory=768m,memory-swap=768m,cpu-period=100000,cpu-quota=20000"], root);
  ownedBuilder = builder;
  try {
    await run(["docker", "buildx", "build", "--builder", builder, "--load", "--build-arg", `RELEASE_SHA=${sha}`,
      "-f", "apps/backend/Dockerfile", "-t", image, "."], root);
  } finally {
    // Stop owned build work even if the client fails or times out. A cleanup
    // failure also blocks acceptance; no production state has changed yet.
    await cleanupReleaseBuilder(run, root);
  }
}
