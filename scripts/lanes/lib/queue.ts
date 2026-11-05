// Queue helpers. Slices dropped into <lane>.inbox/ (file name = slice id) join the queue without racing the state file.
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { inboxPath } from "./config";
import { event, save, type Current, type State } from "./state";

export function drainInbox(s: State): boolean {
  if (!existsSync(inboxPath)) return false;
  let changed = false;
  for (const f of readdirSync(inboxPath)) {
    const id = f.replace(/\.[^.]*$/, "");
    if (/^[a-z0-9-]+$/.test(id) && !s.queue.includes(id) && !s.done.some((d) => d.id === id)) { s.queue.push(id); changed = true; event(`QUEUE added ${id} from inbox`); }
    try { unlinkSync(`${inboxPath}/${f}`); } catch {}
  }
  return changed;
}
export const nextSlice = (s: State) => s.queue.find((q) => !s.done.some((d) => d.id === q) && !(s.parked ?? []).some((p) => p.id === q));
export function park(s: State, c: Current, reason: string, sha: string) {
  (s.parked ??= []).push({ id: c.id, reason, sha, at: new Date().toISOString() });
  s.current = null; save(s); event(`PARK ${c.id}: ${reason}`);
}
