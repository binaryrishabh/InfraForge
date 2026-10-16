import type { AuthoringDraft } from "./index";
// Loaded only by an explicit owner action. These are product educational inputs,
// not provider measurements, a test fixture import or automatic simulation defaults.
export function educationalExample(): AuthoringDraft {
  return { schema: "infraforge-authoring/1", origin: "InfraForge authored educational example M2L/1; owner reviewed, no physical measurement", values: {
    horizon: "40000", sample: "2000", start: "1000", rate: "30000", readRatio: "0.75", payload: "96", readCpu: "30", writeCpu: "45", appWait: "0", cores: "1", workers: "2", queue: "24", parallel: "1", callerTimeout: "2000",
    capacity: "8192", objectCpu: "3", objectWait: "0", objectConcurrency: "2", objectQueue: "24", objectTimeout: "2000", port: "8080", bandwidth: "100000000", propagation: "5", buffer: "8192", connections: "2", streams: "1", poolQueue: "24", establish: "0", acquire: "1000", connect: "1000", response: "1000", requestBytes: "96", responseBytes: "96", maxEvents: "10000", maxRequests: "128", maxSamples: "32", maxTraceRows: "128", maxRawResults: "128" },
    vmAddress: "192.0.2.10", objectAddress: "192.0.2.20", callerAddress: "198.51.100.10", zone: "internal", security: "plaintext-reviewed",
    commands: [{ at: "2000", kind: "put", namespace: "example", key: "note", bytes: "24", content: "authored example" }, { at: "18000", kind: "get", namespace: "example", key: "note", bytes: "", content: "" }, { at: "30000", kind: "delete", namespace: "example", key: "note", bytes: "", content: "" }],
    crash: true, crashAt: "10000", crashDuration: "4000", restart: "2000" };
}
