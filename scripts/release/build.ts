import { command } from "./process";

// Plain BuildKit build on the host's default builder at full speed. The old
// capped builder (0.2 CPU) made every release take about eleven minutes.
export async function buildReleaseImage(sha: string, image: string, root: string, run = command) {
  await run(["docker", "build", "--build-arg", `RELEASE_SHA=${sha}`, "-f", "apps/backend/Dockerfile", "-t", image, "."], root);
}
