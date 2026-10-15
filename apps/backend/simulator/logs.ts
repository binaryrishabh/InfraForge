import type { SimulationLog } from "@infraforge/contracts/telemetry";

// Preserve engine outcomes; avoid presenting expiry of an injected fault as recovery.
export function displaySimulationLogs(logs: SimulationLog[]): SimulationLog[] {
  return logs.map((log) => {
    const prefix = `${log.resourceId} recovered from `;
    if (log.source === "chaos" && log.resourceId && log.message.startsWith(prefix)) {
      return { ...log, message: `${log.resourceId} injected fault ended: ${log.message.slice(prefix.length)}; system recovery is not established.` };
    }
    if (log.resourceId && log.message.startsWith(`utilization recovered on ${log.resourceId} — cpu `)) {
      return { ...log, message: `${log.resourceId} recorded Healthy — CPU ${log.message.split(" — cpu ")[1]}` };
    }
    if (log.source === "nginx" && log.resourceId && log.message === `${log.resourceId} recovered — backends healthy, 502s stopped`) {
      return { ...log, message: `${log.resourceId} recorded no failed or saturated placed backend in the previous-tick measurements.` };
    }
    return log;
  });
}
