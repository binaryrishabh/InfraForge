// Admission, execution and retention limits are software policies, not cloud capacity.
export const INTERNAL_LIMITS = {
  requestBytes: 262144, inputBytes: 524288, evidenceBytes: 262144,
  events: 10000, requests: 256, samples: 64, commands: 16, captures: 32,
  horizonUs: 1000000, records: 2048, fields: 50000, textCharacters: 250000,
  ownerRuns: 100, globalRuns: 1000, activeRuns: 4, deliveries: 4
} as const;
export function jsonBytes(value: unknown, limit: number) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text, "utf8") > limit) throw Error("Internal Model-2 persistence budget exceeded");
  return text;
}
