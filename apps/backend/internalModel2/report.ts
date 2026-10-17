import { executionSource } from "./identity";
import { readEnvelope, captureCuts } from "./envelope";
import { readCapture, instantiate, capture } from "./capture";
import type { InternalRunRow } from "./store";
import { compatibleV1Source, compatibleReviewedSource } from "./legacyCompatibility";
import { decodeCausal } from "./causalJournal";
function recordedCapture(row: InternalRunRow, source: string | null) {
  const evidence = readCapture(row.evidence, row.inputHash);
  const input = readEnvelope(row.input, row.inputHash, false);
  if ((input.schema === "infraforge-internal-execution/2") !== (evidence.schema === "infraforge-internal-evidence/2")) throw Error("Execution/evidence version mismatch");
  if (evidence.sequence !== row.sequence || evidence.throughUs !== row.throughUs || source !== null && evidence.source !== source) throw Error("Stored evidence metadata gap or source mismatch");
  return evidence;
}
export function internalReport(row: InternalRunRow) {
  let inputValid = false, evidence: ReturnType<typeof readCapture> | null = null;
  const unknown = ["Physical throughput/cloud timing/durability and full pricing are Unknown. This INTERNAL authored simulation is not a production-ready cloud model."], problems: string[] = [];
  try { readEnvelope(row.input, row.inputHash, false); inputValid = true; } catch (e) { problems.push(e instanceof Error ? e.message : "Input unavailable"); }
  if (row.evidence !== null) { try {
    evidence = recordedCapture(row, inputValid ? readEnvelope(row.input, row.inputHash, false).source : null);
  } catch (e) { problems.push(e instanceof Error ? e.message : "Evidence unavailable"); } }
  else problems.push("No durable execution capture is available");
  const source = evidence?.source ?? (inputValid ? readEnvelope(row.input, row.inputHash, false).source : null);
  const compatible = source !== null && (compatibleReviewedSource(source, executionSource) || evidence?.schema !== "infraforge-internal-evidence/2" && compatibleV1Source(source, executionSource));
  if (row.status !== "completed") unknown.push("This is a retained prefix, not proof of a complete execution. Missing time/work is not zero.");
  if (evidence && !evidence.usage.snapshot.complete) unknown.push(...evidence.usage.snapshot.reasons);
  if (evidence?.schema === "infraforge-internal-evidence/2" && !evidence.completeness.exactCausality) unknown.push("Exact request causality is Unknown: bounded causal/caller evidence was omitted. Missing events are not zero.");
  if (evidence?.schema === "infraforge-internal-evidence/2" && evidence.model.counts.inFlight) unknown.push("The authored horizon ended with in-flight callers; their future outcomes are right-censored and Unknown.");
  const values = inputValid && evidence ? evidence.presentation.values : {};
  const connected = inputValid && readEnvelope(row.input, row.inputHash, false).schema === "infraforge-internal-execution/2";
  return { schema: connected ? "infraforge-internal-report/2" : "infraforge-internal-report/1", internal: true, model: "2", id: row.id, status: row.status, reason: row.reason,
    inputHash: row.inputHash, source, sequence: row.sequence, throughUs: row.throughUs, inputValid, problems,
    replay: { compatible: inputValid && evidence !== null && compatible, reason: !inputValid ? "Recorded input is unavailable/corrupt/incompatible" : !evidence ? "No valid durable capture is available to replay" : !compatible ? "Execution source differs; historical evidence is read without reinterpretation" : "Read-only deterministic prefix replay is available" },
    observed: Object.entries(values).filter(([, v]) => v.kind === "Observed"), interpreted: Object.entries(values).filter(([, v]) => v.kind === "Interpreted"),
    unknown: [...unknown, ...Object.entries(values).filter(([, v]) => v.kind === "Unknown").map(([key, v]) => `${key}: ${v.kind === "Unknown" ? v.reason : "Unknown"}`)],
    state: inputValid && evidence ? evidence.model : null,
    ...(inputValid && evidence?.schema === "infraforge-internal-evidence/2" ? { causality: { complete: evidence.completeness.exactCausality, omitted: evidence.completeness.causalOmitted, events: decodeCausal(evidence.model.causal) } } : {}),
    checkpoints: inputValid && evidence ? evidence.checkpoints : [],
    usage: inputValid && evidence ? { kind: evidence.usage.snapshot.complete ? "Observed" : "Unknown", complete: evidence.usage.snapshot.complete, measurements: evidence.usage.snapshot.complete ? evidence.usage.snapshot.measurements : [], reasons: evidence.usage.snapshot.reasons, provenance: evidence.usage.config.provenance, providerBilling: "Unknown" } : null };
}
export function replayStored(row: InternalRunRow) {
  const envelope = readEnvelope(row.input, row.inputHash), expected = recordedCapture(row, envelope.source), runtime = instantiate(envelope);
  let actual: ReturnType<typeof capture> | undefined;
  for (const at of captureCuts(envelope).slice(0, expected.sequence)) {
    try { runtime.advanceTo(at); } catch { /* Capture the same deterministic failure, if this prefix contains one. */ }
    actual = capture(runtime, envelope, (actual?.sequence ?? 0) + 1, actual?.checkpoints ?? []);
  }
  if (!actual) throw Error("No durable prefix is available");
  return { kind: actual.fingerprint === expected.fingerprint ? "MatchesRecordedPrefix" : "Mismatch", input: envelope.fingerprint,
    expected: expected.fingerprint, actual: actual.fingerprint, throughUs: actual.throughUs,
    complete: row.status === "completed" && actual.model.capture.reachedHorizon && actual.usage.snapshot.complete,
    mutation: "None; replay writes no product state" };
}
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function reportHtml(report: ReturnType<typeof internalReport>) {
  const section = (title: string, value: unknown) => `<section><h2>${title}</h2><pre>${escape(JSON.stringify(value, null, 2))}</pre></section>`;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Internal Model-2 report</title><style>body{max-width:76rem;margin:2rem auto;padding:0 1rem;font:16px/1.5 system-ui;background:#111827;color:#e5e7eb}h1,h2{color:#fff}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:1rem;background:#1f2937;border-radius:.5rem}section{margin:2rem 0}</style><h1>Internal Model-2 report</h1><p>Model 1 ACTIVE · Model 2 INTERNAL · production PARKED</p><p>${escape(report.id)} · ${escape(report.status)} · retained through ${escape(report.throughUs)} us</p>${section("Recorded identity and compatibility", { input: report.inputHash, source: report.source, replay: report.replay, reason: report.reason, problems: report.problems })}${section("Observed modeled facts", report.observed)}${section("Interpreted", report.interpreted)}${section("Unknown and limits", report.unknown)}${section("Retained service and infrastructure state", { latest: report.state, checkpoints: report.checkpoints })}${section("Usage evidence", report.usage)}</html>`;
}
