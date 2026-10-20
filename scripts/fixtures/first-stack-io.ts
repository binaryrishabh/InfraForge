import { firstStackCompileFixture } from "./first-stack-compile";
import { finiteIoFixture, iq } from "../../packages/simulation/tests/finiteIoFixture";

export async function firstStackIoFixture(warm = false) {
  const f = await firstStackCompileFixture(2);
  const profile = finiteIoFixture().profile;
  profile.identity.workload = f.schedule.identity;
  profile.buffers[0]!.host = "host-db";
  profile.buffers[0]!.capacityBytes = iq(128, "bytes");
  profile.buffers[0]!.initialPages = warm ? ["page-hot", "page-cold"] : [];
  profile.limits.maxReceipts = 1000;
  profile.bindings = ["read", "health"].flatMap(operation => (operation === "health" ? ["cold"] : ["hot", "cold"]).map(key => ({
    role: "db", operation, keys: [key], buffer: "buffer", statementPages: [[`page-${key}`]], walBytes: iq(0, "bytes"), walOperations: iq(0, "count"), commitAck: "read-only" as const,
  })));
  return { ...f, profile };
}
