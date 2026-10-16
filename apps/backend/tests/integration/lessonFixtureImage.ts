import { randomUUID } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { DockerConnection } from "../../internalModel2/dockerConnection";

// Trusted test source only. A stopped container avoids a separately selected BuildKit builder.
export async function withFixtureImage<T>(control: DockerConnection, baseImage: string, output: string, source: string, run: (image: string) => Promise<T>) {
  if (!/^sha256:[a-f0-9]{64}$/.test(baseImage)) throw Error("Fixture requires an immutable base image");
  await mkdir(output, { recursive: true });
  const file = join(output, "sandboxChild.ts"), tag = `infraforge-fixture-${randomUUID()}`;
  await Bun.write(file, source); await chmod(file, 0o644);
  let id = "", image = "";
  const remove = async () => {
    const state = JSON.parse(await control.run(["inspect", id]))[0];
    if (state.Id !== id || state.Image !== baseImage || state.State.Running || state.Config.Labels?.["infraforge.fixture"] !== tag || state.Mounts.length) throw Error("Fixture container identity changed; refusing cleanup");
    await control.run(["rm", id]); id = "";
  };
  try {
    id = await control.run(["create", "--pull=never", "--network=none", "--name", tag, "--label", `infraforge.fixture=${tag}`, baseImage, "/bin/true"]);
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error("Invalid fixture container identity");
    await control.run(["cp", file, `${id}:/app/apps/backend/internalModel2/sandboxChild.ts`]);
    image = await control.run(["commit", id, tag], 65536, 30000);
    if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw Error("Invalid fixture image identity");
    await remove();
    await Bun.write(join(output, "fixture-image.json"), JSON.stringify({ method: "stopped-container-copy-commit", baseImage, image, connection: control.receipt }, null, 2));
    return await run(image);
  } finally {
    if (id) await remove();
    if (image) await control.run(["image", "rm", tag]);
  }
}
