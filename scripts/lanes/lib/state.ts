import { appendFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { eventsPath, statePath } from "./config";

export type Current = { id: string; attempt: number; resumes: number; sessionId: string; baseSha: string; startedAt: string; log: string; logStart?: number;
  pid: number; script?: string; quotaRetries?: number };
// A base update that could not be merged without a human decision. Both sides stay untouched.
export type SyncConflict = { at: string; from: string; laneHead: string; integrationHead: string; files: string[] };
export type State = { account: "default" | "acc2"; model: string; effort: string; worktree: string; branch: string; syncFrom?: string; queue: string[];
  done: Array<{ id: string; sha: string; finishedAt: string }>; parked?: Array<{ id: string; reason: string; sha: string; at: string }>;
  syncConflicts?: SyncConflict[]; current: Current | null; stopped: { reason: string; at: string } | null };

const now = () => new Date().toISOString();
export const event = (msg: string) => { appendFileSync(eventsPath, `${now()} ${msg}\n`); console.log(msg); };
export const load = (): State => JSON.parse(readFileSync(statePath, "utf8"));
// Atomic replace, so a reader (or a crash) never sees a half-written state file.
export const save = (s: State) => { const tmp = `${statePath}.tmp`; writeFileSync(tmp, JSON.stringify(s, null, 2)); renameSync(tmp, statePath); };
export { now };
