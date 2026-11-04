import type { Quantity } from "../../reality/quantity";
export function assumedPayloads(q: (id: string, value: number, unit: "bytes") => Quantity<"bytes">) {
  return { light: q("payload.light", 1024, "bytes"), medium: q("payload.medium", 16384, "bytes"), heavy: q("payload.heavy", 262144, "bytes") };
}
