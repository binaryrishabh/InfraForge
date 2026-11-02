/** Modeled resident memory (from your numbers); no process measurement. */
export interface VmMemoryReading {
  id: string; residentBytes: number | null; limitBytes: number | null; headroomBytes: number | null;
  holdingRequests: number | null; activeRequests: number | null; allocationRejected: number | null;
  comparison: "within" | "exceeds" | "unknown"; peakResidentBytes: number | null;
}
export interface VmMemoryMetrics { version: 1; resources: VmMemoryReading[] }
