import type { Client } from "pg";
import { canonical, designRevision, hash } from "../canonical";
import { inputDigest, readIsolatedCut, type IsolatedCut } from "../isolationProtocol";
import type { IsolationAuthority } from "../isolationRunner";
import type { executeFirstStackIsolated } from "../isolatedExecution";
import { serverChallenges, prepareChallengeWorkload, validateChallengeDesign, type ChallengeRegistry } from "./definition";
import { ScoringUnavailableError, scoringUnavailable } from "./privateStore";
import { evaluateWorkload, scoreRecord } from "./scoring";

type Result = Awaited<ReturnType<typeof executeFirstStackIsolated>>;
export interface HiddenTarget { inputHash: string; lock: unknown; cut: IsolatedCut | null }
export function challengeFence(visible: { check(db: Client): Promise<void>; commit(db: Client, cut: IsolatedCut): Promise<void> }, source: string) {
  let target: HiddenTarget | null = null;
  return { select(value: HiddenTarget | null) { target = value; }, check: visible.check,
    async commit(db: Client, cut: IsolatedCut) {
      if (!target) return visible.commit(db, cut);
      readIsolatedCut(cut, source, target.inputHash, target.cut ?? undefined);
      if ((!target.cut && cut.cut.sequence !== 1) || hash(cut.cut.lock) !== hash(target.lock)) throw Error("Hidden workload compile lock changed");
      // Only the latest bounded cut is retained per workload. A crash leaves the
      // reservation in recovery; there is no hidden-run retry or score to resume.
      target.cut = cut;
    } };
}
// The caller must hold slice 10b's session ownership across this entire serial
// sequence. Only the production worker supplies the executor and commit fence.
export async function executeScoredChallenge(run: any, sample: Result, authority: IsolationAuthority, signal: AbortSignal,
  select: (target: HiddenTarget | null) => void, execute: (input: string, authority: IsolationAuthority, signal: AbortSignal) => Promise<Result>,
  registry: ChallengeRegistry = serverChallenges) {
  const visible = sample.durablePrefix;
  if (run.purpose !== "scored") return null;
  if (sample.status !== "completed" || sample.receipt.cleanup !== "removed" || !visible ||
    !visible.cut.completeness.horizonReached || visible.cut.interruption || hash(visible.cut.lock) !== hash(run.lock) ||
    visible.source !== run.engine.source || visible.inputHash !== run.inputHash || visible.fingerprint !== run.browserCut.fingerprint) return null;
  readIsolatedCut(visible, run.engine.source, run.inputHash);
  let definition;
  try { definition = registry.scoring(run.workload.challenge); }
  catch (error) {
    if (error instanceof ScoringUnavailableError) return scoringUnavailable();
    throw error;
  }
  const saved = JSON.parse(run.input);
  if (inputDigest(run.input) !== run.inputHash || designRevision(saved.layout) !== run.lineage.designRevision ||
    hash(saved.layout.firstStack) !== hash(saved.candidate)) throw Error("Scored saved design identity changed");
  validateChallengeDesign(saved.layout, definition);
  const records: Parameters<typeof scoreRecord>[2] = [];
  for (const workload of definition.hidden) {
    signal.throwIfAborted();
    await authority.assertHeld(signal);
    const prepared = await prepareChallengeWorkload(run.ownerId, saved.layout, definition, workload);
    const input = canonical({ owner: run.ownerId, layout: saved.layout, candidate: prepared.sidecar, recording: prepared.schedule, policy: prepared.policy });
    const target: HiddenTarget = { inputHash: inputDigest(input), lock: prepared.lock, cut: null };
    select(target);
    const result = await execute(input, authority, signal);
    await authority.assertHeld(signal);
    if (!["removed", "not-created"].includes(result.receipt.cleanup)) throw Error("Hidden executor cleanup unconfirmed");
    const evidence = result.status === "completed" && result.receipt.cleanup === "removed" && target.cut && result.durablePrefix &&
      target.cut.fingerprint === result.durablePrefix.fingerprint ? target.cut : null;
    records.push({ reference: workload, input, evidence, receipt: result.receipt, outcomes: evaluateWorkload(definition, workload, input, evidence) });
  }
  select(null);
  return scoreRecord(definition, run, records);
}
