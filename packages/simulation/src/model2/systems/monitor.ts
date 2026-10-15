import { requireKnown } from "../../reality/quantity";
import { copy } from "./copy";
import { messageClient } from "../async/client";
import type { Deliver } from "../compute/run";
import type { EventKernel } from "../time";
import type { Invocation } from "../workload/contracts";
import type { MonitorConfig, Telemetry, TelemetryConfig } from "./contracts";
import { systemService } from "./service";
import { eventRows, SYSTEM_LIMITS } from "./policy";
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, v]) => [key, canonical(v)])) : value;
const sampleIdentity = (s: Telemetry) => JSON.stringify([s.id, s.target, s.measurementAt, s.collectedAt, s.bytes, canonical(s.values)]);

export function telemetryBackend(config: TelemetryConfig, kernel: EventKernel) {
  const records = new Map<string, Telemetry & { arrivedAt: number }>(), latest = new Map<string, { measurementAt: number; arrivedAt: number }>(); let received = 0, duplicates = 0, refused = 0;
  const recent = new Map<string, Array<Telemetry & { arrivedAt: number }>>();
  const service = systemService(config.id, config, kernel, (work, done) => {
    const batch = (work.message?.request as { samples?: Telemetry[] })?.samples;
    if (!Array.isArray(batch) || !batch.length || batch.length > SYSTEM_LIMITS.entries || batch.some((s) => !s || typeof s.id !== "string" || typeof s.target !== "string" || !Number.isSafeInteger(s.bytes) || s.bytes < 0 || !Number.isSafeInteger(s.measurementAt) || s.measurementAt < 0 || !Number.isSafeInteger(s.collectedAt) || s.measurementAt > s.collectedAt || s.collectedAt > kernel.now)) { refused++; done({ ok: false, reason: "invalid-telemetry" }); return; }
    const fresh = new Set(batch.filter((s) => !records.has(s.id)).map((s) => s.id));
    const identities = new Map<string, string>();
    for (const sample of batch) { const identity = sampleIdentity(sample), old = records.get(sample.id); if ((old && sampleIdentity(old) !== identity) || (identities.has(sample.id) && identities.get(sample.id) !== identity)) { refused++; done({ ok: false, reason: "telemetry-identity-conflict" }); return; } identities.set(sample.id, identity); }
    if (records.size + fresh.size > requireKnown(config.samples, "count")) { refused++; done({ ok: false, reason: "telemetry-backend-capacity" }); return; }
    for (const s of batch) { received++; if (records.has(s.id)) duplicates++; else { records.set(s.id, { ...copy(s), arrivedAt: kernel.now }); if (s.measurementAt >= (latest.get(s.target)?.measurementAt ?? -1)) latest.set(s.target, { measurementAt: s.measurementAt, arrivedAt: kernel.now }); } }
    for (const sample of batch) { const row = records.get(sample.id)!, previous = recent.get(sample.target) ?? []; recent.set(sample.target, [...previous.filter((r) => r.id !== row.id), row].sort((a, b) => b.measurementAt - a.measurementAt || (a.id < b.id ? -1 : 1)).slice(0, 2)); }
    done({ ok: true });
  });
  return { ...service, recent: (target: string) => (recent.get(target) ?? []).map(copy), evidence: () => ({ id: config.id, received, duplicates, refused, samples: [...records.values()].map((s) => copy(s)), latest: [...latest.entries()].map(([target, sample]) => ({ target, ...sample, ageUs: kernel.now - sample.measurementAt })), freshnessPolicy: "Age only; no backend health threshold authored", service: service.serviceEvidence() }) };
}
export function monitoringAgent(config: MonitorConfig, kernel: EventKernel, send: Deliver) {
  const buffered = new Map<string, { sample: Telemetry; attempts: number }>(), inFlight = new Map<string, Array<{ sample: Telemetry; attempts: number }>>(), last = new Map<string, number>();
  const events = eventRows(); let sequence = 0, command = 0, bufferedBytes = 0, inFlightBytes = 0, generated = 0, exported = 0, dropped = 0, droppedBeforeExport = 0, discardedUnconfirmed = 0, collections = 0, collectionFailures = 0, batches = 0, failedBatches = 0, exporting = false;
  const service = systemService(config.id, config, kernel, (work, done) => {
    const r = work.message?.request as { kind: string; target?: string }, ask = messageClient(work, send);
    if (r.kind === "collect") {
      collections++;
      const receipt = ask<{ ok: boolean; measurementAt: number; values: unknown }>(r.target!, { kind: "observe" }, (reply, outcome) => {
        if (outcome !== "completed" || !reply?.ok) { collectionFailures++; events.add(kernel.now, "collection-gap", r.target!, "target observation unavailable"); done({ ok: false, reason: "collection-failed" }); return; }
        const sample: Telemetry = { id: JSON.stringify([config.id, sequence++]), target: r.target!, measurementAt: reply.measurementAt, collectedAt: kernel.now, bytes: requireKnown(config.sampleBytes, "bytes"), values: copy(reply.values) };
        generated++; last.set(sample.target, sample.measurementAt);
        const owned = buffered.size + [...inFlight.values()].reduce((n, rows) => n + rows.length, 0);
        if (owned >= requireKnown(config.bufferSamples, "count") || bufferedBytes + inFlightBytes + sample.bytes > requireKnown(config.bufferBytes, "bytes")) { dropped++; droppedBeforeExport++; events.add(kernel.now, "telemetry-drop", sample.id, "drop-newest: buffer capacity"); }
        else { buffered.set(sample.id, { sample, attempts: 0 }); bufferedBytes += sample.bytes; }
        done({ ok: true });
      }); return () => { receipt.cancel(); };
    }
    if (r.kind !== "export") { done({ ok: false, reason: "unsupported-monitor-command" }); return; }
    const rows: Array<{ sample: Telemetry; attempts: number }> = []; for (const row of buffered.values()) { rows.push(row); if (rows.length >= requireKnown(config.batchSamples, "count")) break; } if (!rows.length) { done({ ok: true }); return; }
    const batchId = work.callId, bytes = rows.reduce((n, row) => n + row.sample.bytes, 0); batches++;
    for (const row of rows) { buffered.delete(row.sample.id); row.attempts++; } bufferedBytes -= bytes; inFlightBytes += bytes; inFlight.set(batchId, rows);
    const receipt = ask<{ ok: boolean }>(config.backend, { kind: "export", samples: rows.map((row) => row.sample) }, (reply, outcome) => {
      if (!inFlight.delete(batchId)) return; inFlightBytes -= bytes;
      if (outcome === "completed" && reply?.ok) { exported += rows.length; done({ ok: true }); return; }
      failedBatches++;
      for (const row of rows) {
        if (row.attempts < requireKnown(config.attempts, "count")) { buffered.set(row.sample.id, row); bufferedBytes += row.sample.bytes; }
        else { dropped++; discardedUnconfirmed++; events.add(kernel.now, "telemetry-discard-unconfirmed", row.sample.id, "attempts exhausted; backend may already have received an ambiguous export"); }
      }
      done({ ok: false, reason: "export-failed" });
    }, bytes); return () => { receipt.cancel(); };
  });
  const invoke = (kind: "collect" | "export", target?: string) => {
    const work: Invocation = { rootId: JSON.stringify(["monitor", config.id, command]), callId: JSON.stringify(["monitor", config.id, command++]), operation: config.operation, attempt: 1, offeredAt: kernel.now, message: { request: { kind, target } } };
    service.accept(work, () => { if (kind === "export") exporting = false; });
  };
  return { ...service, start(horizon: number) {
    const schedule = (kind: "collect" | "export", interval: number, target?: string) => {
      const tick = () => { if (kind === "collect") invoke(kind, target); else if (!exporting && buffered.size) { exporting = true; invoke(kind); } const at = kernel.now + interval; if (at < horizon) kernel.schedule(at, 2, JSON.stringify(["monitor-tick", config.id, kind, target ?? "export"]), tick); };
      if (interval < horizon) kernel.schedule(interval, 2, JSON.stringify(["monitor-tick", config.id, kind, target ?? "export"]), tick);
    };
    for (const target of config.targets) schedule("collect", requireKnown(config.interval, "us"), target);
    schedule("export", requireKnown(config.exportInterval, "us"));
  }, evidence: () => ({ id: config.id, generated, exported, dropped, droppedBeforeExport, discardedUnconfirmed, collections, collectionFailures, batches, failedBatches, bufferedBytes, inFlightBytes, buffered: [...buffered.values()].map((r) => copy(r)), inFlight: [...inFlight.entries()].map(([id, rows]) => ({ id, rows: copy(rows) })), freshness: config.targets.map((target) => { const measuredAt = last.get(target); return { target, measuredAt: measuredAt ?? null, ageUs: measuredAt === undefined ? null : kernel.now - measuredAt, state: measuredAt === undefined ? "missing" : kernel.now - measuredAt > requireKnown(config.freshFor, "us") ? "stale" : "fresh" }; }), events: events.snapshot(), service: service.serviceEvidence(), scope: "Agent-owned collected metrics only; dropped means local ownership discarded, with pre-export loss separate from unconfirmed export; backend arrival is independent. Target instrumentation CPU Unknown; no reconstructed samples" }) };
}
