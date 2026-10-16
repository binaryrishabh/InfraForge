import { canonical } from "../../model2/product/provenance";
import { digest } from "../provider/fingerprint";
import type { ContentHasher } from "../provider/fingerprint";
import type { MeteringConfig, RuntimeUsageObserver, UsageRecord, UsageSource } from "./contracts";
import type { SourceMeasurement, UsageFrame, UsageSnapshot } from "./measurements";
import { ObjectMeter } from "./object-meter";
import { LinkMeter } from "./link-meter";
import { configValid, count, retainedSize, text } from "./validation";

interface SourceState {
  id: string;
  descriptor: UsageSource;
  producer: () => number;
  sequence: number;
  lastAt: number;
  signatures: Map<number, string>;
  meter: ObjectMeter | LinkMeter;
}
export function usageJournal(authored: MeteringConfig, hasher: ContentHasher) {
  configValid(authored);
  const config = canonical(authored), sources = new Map<string, SourceState>(), records: UsageRecord[] = [], reasons: string[] = [];
  config.objects.sort(); config.links.sort();
  const selections = { "object-store": new Set(config.objects), link: new Set(config.links) };
  let failed = false, omittedRecords = 0, fields = 0, textCharacters = 0;
  const invalidate = (reason: string) => { failed = true; if (reasons.length < 16 && !reasons.includes(reason)) reasons.push(reason.slice(0, 512)); };
  const observer: RuntimeUsageObserver = {
    select: (family, resource) => selections[family].has(resource),
    attach(descriptor, producer) {
      const id = JSON.stringify([descriptor.family, descriptor.resource, descriptor.profile]);
      try {
        text(descriptor.resource, 160);
        if (!selections[descriptor.family].has(descriptor.resource) || sources.has(id) || typeof producer !== "function") throw Error("Unselected or duplicate usage producer");
        if (descriptor.family === "object-store" ? descriptor.profile !== "atomic-current-object/1" : descriptor.profile !== "directed-payload/1") throw Error("Unsupported usage source profile");
        if (descriptor.family === "link") { text(descriptor.from, 160); text(descriptor.to, 160); }
        const state: SourceState = { id, descriptor: canonical(descriptor), producer, sequence: 0, lastAt: 0, signatures: new Map(), meter: descriptor.family === "object-store" ? new ObjectMeter(descriptor.resource) : new LinkMeter(descriptor) };
        sources.set(id, state);
        return (value) => {
          if (failed) { omittedRecords++; return; }
          try {
            count(value.sequence); count(value.atUs);
            if (value.source !== id || value.sequence < 1) throw Error("Usage event source/sequence mismatch");
            const size = retainedSize(value, config.maxFields, config.maxTextCharacters), record = canonical(value), signature = JSON.stringify(record);
            if (value.sequence <= state.sequence) {
              if (state.signatures.get(value.sequence) !== signature) throw Error("Conflicting duplicate usage event");
              return;
            }
            if (value.sequence !== state.sequence + 1 || value.atUs < state.lastAt) throw Error("Usage sequence gap or late event");
            if (records.length >= config.maxRecords || fields + size.fields > config.maxFields || textCharacters + size.characters > config.maxTextCharacters) throw Error("Usage retention budget exhausted; quantities are incomplete");
            if (state.meter instanceof ObjectMeter) state.meter.apply(record.detail, record.atUs); else state.meter.apply(record.detail);
            state.sequence = record.sequence; state.lastAt = record.atUs; state.signatures.set(record.sequence, signature);
            records.push(record); fields += size.fields; textCharacters += size.characters;
          } catch (cause) { omittedRecords++; invalidate(cause instanceof Error ? cause.message : "Invalid usage event"); }
        };
      } catch (cause) { invalidate(cause instanceof Error ? cause.message : "Invalid usage producer"); return () => { omittedRecords++; }; }
    }
  };
  function capture(atUs: number, executionFailure: string | null = null): UsageSnapshot {
    count(atUs);
    const issues = [...reasons], measurements: SourceMeasurement[] = [], ordered = [...sources.values()].sort((a, b) => a.id < b.id ? -1 : 1);
    const sourceHeads = ordered.map((state) => {
      let producerHead = state.sequence;
      try { producerHead = state.producer(); count(producerHead); if (producerHead !== state.sequence) issues.push(`Producer watermark gap/reset: ${state.descriptor.resource}`); }
      catch { issues.push(`Producer watermark unavailable: ${state.descriptor.resource}`); }
      try { if (state.lastAt > atUs) throw Error("Capture precedes retained events"); measurements.push(state.meter instanceof ObjectMeter ? state.meter.snapshot(atUs) : state.meter.snapshot()); }
      catch (cause) { issues.push(cause instanceof Error ? cause.message : "Incomplete usage state"); }
      return { id: state.id, descriptor: state.descriptor, producerHead, collectedHead: state.sequence };
    });
    for (const [family, ids] of Object.entries(selections)) for (const id of ids) if (!ordered.some((s) => s.descriptor.family === family && s.descriptor.resource === id)) issues.push(`Selected producer missing: ${family}/${id}`);
    if (executionFailure) issues.push(`Interrupted/incomplete execution: ${executionFailure}`);
    const payload = { schema: "infraforge-usage-snapshot/1" as const, config, atUs, complete: !failed && !issues.length, reasons: [...new Set(issues)].slice(0, 16), omittedRecords, sources: sourceHeads, measurements };
    return canonical({ ...payload, fingerprint: digest(payload, hasher) });
  }
  function frame(snapshot: UsageSnapshot): UsageFrame {
    const { fingerprint, ...payload } = snapshot;
    if (digest(payload, hasher) !== fingerprint || digest(snapshot.config, hasher) !== digest(config, hasher)) throw Error("Usage snapshot drift or wrong run/input");
    const heads = new Map(snapshot.sources.map((s) => [s.id, s.collectedHead]));
    const retained = records.filter((r) => r.sequence <= (heads.get(r.source) ?? 0)).sort((a, b) => a.source < b.source ? -1 : a.source > b.source ? 1 : a.sequence - b.sequence);
    let retainedFields = 0, retainedText = 0;
    for (const r of retained) { const size = retainedSize(r, config.maxFields, config.maxTextCharacters); retainedFields += size.fields; retainedText += size.characters; }
    const body = { schema: "infraforge-usage-frame/1" as const, config, snapshot, records: retained, retained: { records: retained.length, fields: retainedFields, textCharacters: retainedText } };
    return canonical({ ...body, fingerprint: digest(body, hasher) });
  }
  return { observer, capture, frame, invalidate };
}
