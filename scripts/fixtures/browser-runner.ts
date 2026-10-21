import { firstStackCompileFixture } from "./first-stack-compile";
import { firstStackCacheFixture } from "./first-stack-cache";
import pin from "../../apps/web/src/firstStack/enginePin.json";
import type { BrowserRequest } from "../../apps/web/src/firstStack/protocol";
export async function browserFixture(cache = false): Promise<BrowserRequest> {
  const f = cache ? await firstStackCacheFixture() : await firstStackCompileFixture(2, { shared: true });
  return { engine: { source: pin.source, image: `sha256:${"b".repeat(64)}` }, input: { owner: "qualification", layout: { ...f.layout, firstStack: f.sidecar }, candidate: f.sidecar, recording: f.schedule, policy: f.policy } };
}
