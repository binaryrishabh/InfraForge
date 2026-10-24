import { buildReleaseImage } from "./build";
import { verifyImage } from "./compose";
import { command } from "./process";
import type { Release } from "./sequence";

export type ReleaseAction = "apply" | "reconfigure" | "rollback";
export type AcceptedState = { current: Release; previous?: Release };

export async function prepareReleaseImage(action: ReleaseAction, sha: string, state: AcceptedState | undefined, root: string): Promise<Release> {
  if (action === "apply" && [state?.current.sha, state?.previous?.sha].includes(sha)) {
    throw new Error("This SHA already has a retained accepted image; use reconfigure for current settings or rollback for a previous release");
  }
  if (action === "reconfigure" && (!state?.current || state.current.sha !== sha)) {
    throw new Error("Configuration reapply requires the currently accepted SHA");
  }
  const accepted = action === "reconfigure" ? state!.current : undefined;
  if (accepted) await verifyImage(accepted, root);
  // Use the retained content ID throughout reconfiguration, never build or retag.
  const image = accepted?.imageId ?? `infraforge-backend:${sha}`;
  if (action === "apply") await buildReleaseImage(sha, image, root);
  const [built] = JSON.parse(await command(["docker", "image", "inspect", image], root));
  if (built.Config.Labels?.["org.infraforge.rehearsal"]) throw new Error("Test-only images cannot be accepted for production release");
  const metadata = JSON.parse(await command(["docker", "run", "--rm", "--network", "none", built.Id, "cat", "/app/apps/backend/release.json"], root));
  if (metadata.sha !== sha || typeof metadata.migrationFingerprint !== "string" || !metadata.migrationFingerprint ||
      metadata.authContract !== 1) throw new Error("Embedded release metadata does not match the approved release");
  if (accepted && (built.Id !== accepted.imageId || metadata.migrationFingerprint !== accepted.migrationFingerprint ||
      metadata.authContract !== accepted.authContract)) throw new Error("Embedded metadata differs from the retained accepted image");
  const next: Release = { sha, image, imageId: built.Id, migrationFingerprint: metadata.migrationFingerprint,
    authContract: metadata.authContract, settingsFingerprint: "" };
  await verifyImage(next, root);
  return next;
}
