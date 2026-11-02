import { memoryDesign, tightMemory, memoryState } from "./vmMemory.fixture";
import { prepareKeyspace } from "./keyspace.fixture";
import { createProductModel2 } from "../src/model2/product/run";

export function runMemoryDemonstration() {
  const runCase = (mode: "A" | "B" | "C") => {
    // Small's catalog label is 2 GiB. C has (2048 - 1024) / 128 = 8 holders.
    // B changes only authored memory numbers, leaving room for the entire queue.
    const d = memoryDesign(true, mode === "A" ? undefined : mode === "B" ? { ...tightMemory, baselineMiB: 0, requestMiB: 1 } : tightMemory);
    d.workload.targetThroughput = 260 * 60;
    const f = prepareKeyspace(d, "vm-memory-controlled-demonstration");
    let checkedRefusals = 0, maxHolders = 0, maxQueued = 0;
    const runtime = createProductModel2(f.compiled, undefined, e => {
      if (e.resource !== "app") return;
      const s = memoryState(runtime), m = s.compute!.memory;
      maxHolders = Math.max(maxHolders, m.ownership.requests); maxQueued = Math.max(maxQueued, s.queued);
      if (e.kind === "app-rejected" && e.detail.rootReason === "memory-limit") {
        if (mode !== "C" || m.knownSubtotalBytes + tightMemory.requestMiB * 1048576 <= m.limitBytes!) throw Error("Memory refusal without a projected allocation exceeding the limit");
        checkedRefusals++;
      }
    });
    runtime.advanceTo(3000000);
    const evidence = runtime.evidence(), state = memoryState(runtime), reading = evidence.vmMemory?.resources[0];
    return { mode, counts: evidence.counts, results: evidence.results, admitted: state.admitted, completed: state.completed, maxHolders, maxQueued,
      refused: state.compute!.allocationRejected, checkedRefusals,
      residentMiB: reading?.residentBytes == null ? null : reading.residentBytes / 1048576,
      headroomMiB: reading?.headroomBytes == null ? null : reading.headroomBytes / 1048576,
      peakMiB: reading?.peakResidentBytes == null ? null : reading.peakResidentBytes / 1048576 };
  };
  return [runCase("A"), runCase("B"), runCase("C")] as const;
}
