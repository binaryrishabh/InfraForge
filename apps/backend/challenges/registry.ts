import { createHash } from "node:crypto";
import type { ChallengeCategory, ChallengeDefinition } from "@infraforge/contracts/challenges";
import { CHALLENGE_VERSIONS } from "./definitions";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// The hash covers every authored field, so an attempt records exactly which rules it was judged by.
export function specHash(definition: ChallengeDefinition) {
  return createHash("sha256").update(canonical(definition)).digest("hex");
}

export interface ChallengeEntry { definition: ChallengeDefinition; hash: string }
export interface ChallengeRegistry {
  find(id: string, version: number): ChallengeEntry | null;
  latest(id: string): ChallengeEntry | null;
  listLatest(): ChallengeEntry[];
  all(): ChallengeEntry[];
}

/* Identity is id + version + spec hash. Every version stays resolvable so an old
attempt is judged by the exact rules that created it; the list shows each
challenge's latest version only. */
export function buildRegistry(versions: readonly ChallengeDefinition[]): ChallengeRegistry {
  const byId = new Map<string, ChallengeEntry[]>();
  for (const definition of versions) {
    const entries = byId.get(definition.id) ?? [];
    if (entries.some((e) => e.definition.version === definition.version)) throw new Error(`Duplicate challenge version ${definition.id}@${definition.version}`);
    entries.push({ definition, hash: specHash(definition) });
    byId.set(definition.id, entries);
  }
  for (const entries of byId.values()) entries.sort((a, b) => a.definition.version - b.definition.version);
  const order = [...new Set(versions.map((d) => d.id))];
  return {
    find: (id, version) => byId.get(id)?.find((e) => e.definition.version === version) ?? null,
    latest: (id) => byId.get(id)?.at(-1) ?? null,
    listLatest: () => order.map((id) => byId.get(id)!.at(-1)!),
    all: () => [...byId.values()].flat(),
  };
}

export const REGISTRY = buildRegistry(CHALLENGE_VERSIONS);
export const findChallenge = (id: string, version: number) => REGISTRY.find(id, version);
export const latestChallenge = (id: string) => REGISTRY.latest(id);
export const listLatestChallenges = () => REGISTRY.listLatest();

export const categoryOf = (definition: ChallengeDefinition): ChallengeCategory => definition.experiment ? "resilience" : "design";

// Each version's evaluation uses one fixed seed so two attempts of the same design are reproducible.
export function challengeSeed(definition: ChallengeDefinition) { return `challenge:${definition.id}:v${definition.version}`; }
