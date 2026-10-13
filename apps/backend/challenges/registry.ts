import { createHash } from "node:crypto";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { CHALLENGES } from "./definitions";

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

const registry = new Map(CHALLENGES.map((definition) => [definition.id, { definition, hash: specHash(definition) }]));

export function listChallenges() { return [...registry.values()]; }
export function findChallenge(id: string) { return registry.get(id) ?? null; }

// Each challenge's evaluation uses one fixed seed so two attempts of the same design are reproducible.
export function challengeSeed(definition: ChallengeDefinition) { return `challenge:${definition.id}:v${definition.version}`; }
