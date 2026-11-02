/** Timing ownership audit (traffic-evidence/2 only).
 * caller-offered -> completed caller-terminal owns responseUs, the sole denominator.
 * path-offered -> connection-acquired owns connection acquisition; acquired ->
 * request-delivered owns request transit. A remote-terminal observation is needed
 * for response transit; cumulative path remoteServiceUs includes nested work and
 * is never added. lb-received -> first selection owns LB pending wait.
 * app-admitted -> app-start owns application queue wait; start -> terminal owns
 * application residence, excluding its dependency intervals. app-dependency owns
 * downstream wait until its return; flow step boundaries prove flow dependency wait.
 * client-attempt terminal/issued prove failed attempt time and actual retry delay;
 * LB attempt-terminal proves failed LB attempts (never count overlapping work twice).
 * Database counters do not prove exclusive per-request database internals.
 * Missing boundaries remain unattributed. Health probes have no live caller root.
 * Each measured second uses completed callers only: all-request means divide by
 * completed count; tail means use the same nearest-rank p99 sample, >= threshold,
 * and are Unknown below 100 completions. Failures/stops/in-flight are counts only.
 */
export const TRAFFIC_EVIDENCE_PROFILE = "traffic-evidence/2" as const;
