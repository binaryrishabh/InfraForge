import { canonical } from "../../model2/product/provenance";
import { digest } from "../provider/fingerprint";
import type { ContentHasher } from "../provider/fingerprint";
import type { UsageRecord } from "./contracts";
import type { UsageFrame } from "./measurements";
import { usageJournal } from "./journal";
import { retainedSize } from "./validation";

export function replayUsage(frame: UsageFrame, hasher: ContentHasher, delivery: UsageRecord[] = frame.records) {
  retainedSize(frame, 1000000, 8000000);
  const { fingerprint, ...payload } = frame, { fingerprint: snapshotFingerprint, ...snapshotBody } = frame.snapshot;
  if (frame.schema !== "infraforge-usage-frame/1" || digest(payload, hasher) !== fingerprint || digest(snapshotBody, hasher) !== snapshotFingerprint || digest(frame.config, hasher) !== digest(frame.snapshot.config, hasher)) throw Error("Usage frame/snapshot version or content drift");
  let fields = 0, characters = 0;
  const identities = new Set<string>();
  for (const record of frame.records) {
    const size = retainedSize(record, frame.config.maxFields, frame.config.maxTextCharacters), id = JSON.stringify([record.source, record.sequence]);
    if (identities.has(id)) throw Error("Duplicate retained event identity");
    identities.add(id); fields += size.fields; characters += size.characters;
  }
  if (frame.records.length > frame.config.maxRecords || fields > frame.config.maxFields || characters > frame.config.maxTextCharacters || frame.retained.records !== frame.records.length || frame.retained.fields !== fields || frame.retained.textCharacters !== characters) throw Error("Usage retained budget/accounting mismatch");
  if (delivery.length > frame.config.maxRecords * 2) throw Error("Usage replay delivery budget");
  const journal = usageJournal(frame.config, hasher), sinks = new Map<string, (record: UsageRecord) => void>();
  for (const source of frame.snapshot.sources) sinks.set(source.id, journal.observer.attach(source.descriptor, () => source.producerHead));
  // Complete batches may arrive reordered. Sequence, timestamp and duplicate checks remain at each producer.
  for (const record of [...delivery].sort((a, b) => a.source < b.source ? -1 : a.source > b.source ? 1 : a.sequence - b.sequence)) {
    const sink = sinks.get(record.source);
    if (!sink) journal.invalidate("Replay contains an unselected producer"); else sink(record);
  }
  if (!frame.snapshot.complete) journal.invalidate("Recorded execution or coverage was incomplete");
  let snapshot = journal.capture(frame.snapshot.atUs);
  if (frame.snapshot.complete && snapshot.fingerprint !== frame.snapshot.fingerprint) {
    journal.invalidate("Replay does not reconstruct the issued snapshot"); snapshot = journal.capture(frame.snapshot.atUs);
  }
  return canonical({ matches: snapshot.fingerprint === frame.snapshot.fingerprint, snapshot });
}
