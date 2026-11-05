// Paths and tuning for one lane controller. Nothing here is a secret: account homes, tokens and the Codex launcher
// live in the private, untracked .agent/ops directory of the machine that runs the lanes.
import { resolve } from "node:path";

const slash = (path: string) => path.replace(/\\/g, "/");
export const REPO = slash(resolve(import.meta.dir, "../../.."));
// Worktrees (InfraForge_wt_*) are siblings of the checkout that holds .agent/ops.
export const ROOT = slash(process.env.LANE_ROOT ?? resolve(REPO, ".."));
export const OPS = slash(process.env.LANE_OPS ?? `${ROOT}/InfraForge_Code/.agent/ops`);
export const LAUNCHER = process.env.LANE_LAUNCHER ?? `${OPS}/codex-launch.ps1`;
export const LANES = `${OPS}/lanes`;
export const POLL_MS = Number(process.env.LANE_POLL_MS ?? 60_000);
export const QUOTA_SLACK_MS = Number(process.env.LANE_QUOTA_SLACK_MS ?? 60_000);
export const QUOTA_MIN_MS = Number(process.env.LANE_QUOTA_MIN_MS ?? 60_000);

export const lane = process.argv[2];
if (!lane || !/^[a-z0-9-]+$/.test(lane)) { console.error("usage: lane-controller.ts <lane>"); process.exit(2); }
export const statePath = `${LANES}/${lane}.json`;
export const lockPath = `${LANES}/${lane}.lock`;
export const eventsPath = `${LANES}/${lane}.events.log`;
export const inboxPath = `${LANES}/${lane}.inbox`;
