import type { SimulationLog } from "@infraforge/contracts/telemetry";

// Preserve engine outcomes; avoid presenting expiry of an injected fault as recovery.
export function displaySimulationLogs(logs: SimulationLog[]): SimulationLog[] {
  return logs.map((log) => {
    const prefix = `${log.resourceId} recovered from `;
    return log.source === "chaos" && log.resourceId && log.message.startsWith(prefix)
      ? { ...log, message: `${log.resourceId} injected fault ended: ${log.message.slice(prefix.length)}; system recovery is not established.` }
      : log;
  });
}
