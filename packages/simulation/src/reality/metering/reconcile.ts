import type { ProductEvidence } from "../../model2/product/presentation";
import type { UsageSnapshot } from "./measurements";
import { count, objectRow } from "./validation";
import { canonical } from "../../model2/product/provenance";

export function reconcileUsage(snapshot: UsageSnapshot, actual: ProductEvidence) {
  const errors: string[] = [];
  for (const measured of snapshot.measurements) {
    try {
      if (measured.family === "object-store") {
        const store = actual.asynchronous.objects.find((s) => s.id === measured.resource), station = actual.resources.find((s) => s.id === measured.resource);
        if (!store || !station) throw Error("Object producer missing from actual runtime");
        if (count(store.storedBytes).toString() !== measured.storedBytes || store.generation !== measured.generation || JSON.stringify(canonical(store.objects.map(objectRow))) !== JSON.stringify(canonical(measured.objects))) throw Error("Actual object generations/retained bytes disagree with mutation evidence");
        for (const field of ["received", "admitted", "completed", "failed", "rejected", "cancelled"] as const) {
          const value = (station as unknown as Record<string, number>)[field];
          if (value === undefined || count(value).toString() !== measured.operations[field]) throw Error(`Actual object operation ${field} disagrees with usage evidence`);
        }
        for (const field of ["committedPuts", "replacedObjects", "removedObjects"] as const) if (count(store[field]).toString() !== measured[field]) throw Error("Actual object mutation counts disagree with usage evidence");
      } else {
        const link = actual.network.links.find((s) => s.id === measured.resource);
        if (!link || link.from !== measured.from || link.to !== measured.to) throw Error("Actual link identity/ownership mismatch");
        for (const field of ["offeredBytes", "acceptedBytes", "rejectedBytes", "deliveredBytes", "failedBytes", "liveBytes"] as const) if (count(link[field]).toString() !== measured.totals[field]) throw Error(`Actual link ${field} disagrees with usage evidence`);
      }
    } catch (cause) { errors.push(`${measured.resource}: ${cause instanceof Error ? cause.message : "Reconciliation failed"}`); }
  }
  return errors;
}
