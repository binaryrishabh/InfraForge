import { requireKnown } from "../../reality/quantity";
import { ASYNC_LIMITS } from "../async/policy";
import { keyedUniform } from "../random";
import { identity, openRows } from "../workload/arrivals";
import type { SystemsInput } from "../systems/contracts";
import type { ProductContract } from "./contracts";
import type { derivedLedger } from "./provenance";

/** Publisher body.key is the caller root identity. Materialize only the existing engine's
 * explicit poison key list, including for generated live arrivals. Never truncate it. */
export function compilePoisonKeys(input: SystemsInput, contract: ProductContract, provenance: ReturnType<typeof derivedLedger>) {
  for (const worker of input.resources) {
    if (worker.kind !== "async-worker") continue;
    const percent = contract.nodes[worker.id]?.asyncBadJobPercent;
    if (percent === undefined) continue;
    provenance.audit(percent);
    const share = requireKnown(percent, "percent");
    if (!Number.isSafeInteger(share) || share < 0 || share > 100) throw Error("Invalid poison share");
    if (share === 0) continue;
    const keys: string[] = [];
    let arrivals = 0;
    for (const source of input.arrivals) {
      if (source.kind === "closed") throw Error("Poison selection requires bounded open-loop upload arrivals");
      for (const row of openRows(source, input.seed)) {
        if (++arrivals > input.limits.maxRequests) throw Error("Poison arrival budget exceeded");
        const key = identity("root", source.id, row.id);
        if (keyedUniform(input.seed, worker.id, key, "poison-job/1") >= share / 100) continue;
        if (keys.length >= ASYNC_LIMITS.messages) throw Error("Poison key budget exceeded");
        keys.push(key);
      }
    }
    worker.poisonKeys = keys;
  }
}
