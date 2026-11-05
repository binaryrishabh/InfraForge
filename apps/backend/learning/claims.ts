import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { evidenceLabels, learningMeasurement, type LearningLesson } from "@infraforge/contracts/learning";
import { CLAIM_EXCEPTIONS } from "./claimExceptions";

/** Only learner-visible prose, never ids, versions, choice ids or prerequisites. */
export function lessonText(lesson: LearningLesson): Array<[string, string]> {
  return [
    ["title", lesson.title], ["summary", lesson.summary],
    ...lesson.problem.map((text, i): [string, string] => [`problem.${i}`, text]),
    ...lesson.explanation.map((text, i): [string, string] => [`explanation.${i}`, text]),
    ...lesson.limitations.map((text, i): [string, string] => [`limitations.${i}`, text]),
    ...(lesson.followUp ? [["followUp", lesson.followUp] as [string, string]] : []),
    ...(lesson.check ? [["check.question", lesson.check.question], ["check.explanation", lesson.check.explanation],
      ...lesson.check.choices.map((choice, i) => [`check.choices.${i}`, choice.text])] as Array<[string, string]> : []),
    ...(lesson.experiment ? [["prediction", lesson.experiment.prediction ?? ""],
      ...(lesson.experiment.evidenceToInspect ?? []).map((text, i) => [`evidence.${i}`, text])] as Array<[string, string]> : []),
  ];
}

// SKU names are indivisible: c5.xlarge does not accidentally authorize "5".
// Percentile identifiers and Model 2 identify concepts, not measured values.
export function numericClaims(text: string): string[] {
  const words: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, sixteen: 16 };
  const normalized = text.replace(/\b(?:p(?:50|95|99)|Model\s+2)\b/gi, "")
    .replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|twelve|sixteen)(?=[ -](?:(?:modeled|logical|initial|app)\s+)*(?:seconds?|ms|milliseconds?|cores?|keys?|entries|requests?|reads?|writes?|sessions?|connections?)\b)/gi,
      word => String(words[word.toLowerCase()]))
    .replace(/\bfourfold\b/gi, "4");
  return [...normalized.matchAll(
    /\b(?:[a-z]+\.)?(?:[a-z]+\d+[a-z]*\.)+[a-z\d]+\b|(?<![\w.])\d+(?:,\d{3})*(?:\.\d+)?(?![\w.])/gi,
  )].map(match => match[0].replaceAll(",", "").toLowerCase());
}

function pinnedValues(definition: ChallengeDefinition): Set<string> {
  const values = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "number") values.add(String(value));
    else if (typeof value === "string") {
      values.add(value.toLowerCase());
      numericClaims(value).forEach(n => values.add(n));
    } else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  // Do not let hints, debriefs, coordinates, ids or descriptive labels authorize
  // a workload/threshold claim. These are the pinned input and scoring fields.
  const { workload: w } = definition;
  visit(w);
  values.add(String(definition.evaluationSeconds));
  for (const criterion of definition.criteria) {
    for (const [key, value] of Object.entries(criterion)) if (!["id", "label", "resourceId", "kind"].includes(key)) visit(value);
  }
  for (const resource of definition.starter?.resources ?? []) {
    for (const [key, value] of Object.entries(resource)) if (!["id", "name", "type", "position", "x", "y"].includes(key)) visit(value);
  }
  const perSecond = w.targetThroughput / (w.throughputUnit === "per-minute" ? 60 : 1);
  values.add(String(perSecond));
  values.add(String(perSecond * w.peakMultiplier));
  // Quotas/ratios are authored as fractions, while lessons use percentages.
  for (const value of [...values]) if (Number(value) > 0 && Number(value) < 1) values.add(String(Number(value) * 100));
  return values;
}

export function checkLessonClaims(lesson: LearningLesson, definition?: ChallengeDefinition): string[] {
  const errors: string[] = [], identity = `${lesson.id}@${lesson.contentVersion}`;
  const text = lessonText(lesson);
  if (lesson.kind !== "executable-lab") {
    // Numerical definitions such as the meaning of p95 are conceptual. Refuse
    // numeric units used to assert a run result, including in follow-up/checks.
    for (const [field, prose] of text) if (/\d[\d,.]*\s*(?:ms\b|milliseconds?\b|seconds?\b|s\b|req(?:uests?)?\s*\/\s*s|(?:requests?|reads?|writes?)\s*(?:\/|per|each)\s*(?:second|s)\b|cores?\b|GB\b|MB\b)/i.test(prose)) {
      errors.push(`${identity} ${field}: non-executable lesson contains a digits-with-units result claim`);
    }
    return errors;
  }
  if (!definition) return errors; // Identity failures are reported by authoring.ts.
  const allowed = pinnedValues(definition);
  for (const [field, prose] of text) {
    const exceptions = CLAIM_EXCEPTIONS.filter(e => e.lesson === identity && e.field === field && e.text === prose && e.reason.trim());
    for (const token of numericClaims(prose)) if (!allowed.has(token) && !exceptions.some(e => e.values.includes(token))) {
      errors.push(`${identity} ${field}: unsupported numeric/size claim ${token}: ${prose}`);
    }
    for (const match of prose.matchAll(/\bsecond[ -]+(\d+(?:\.\d+)?)/gi)) {
      if (Number(match[1]) !== definition.evaluationSeconds && !exceptions.some(e => e.values.includes(match[1]!))) {
        errors.push(`${identity} ${field}: unsupported evaluation second ${match[1]}`);
      }
    }
    for (const match of prose.matchAll(/\bp95(?:\s+is)?\s+(?:at most|<=|≤)\s*(\d+(?:\.\d+)?)\s*ms\b/gi)) {
      if (!definition.criteria.some(criterion => criterion.kind === "terminal-p95" && criterion.maxMs === Number(match[1])) &&
        !exceptions.some(e => e.values.includes(match[1]!))) errors.push(`${identity} ${field}: unsupported p95 threshold ${match[1]} ms`);
    }
    // A number that exists as a threshold must not masquerade as a request rate.
    for (const match of prose.matchAll(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:requests?|reads?|writes?)(?:\s*\/\s*|\s+(?:per|each)\s+)(?:second|s)\b/gi)) {
      const rate = Number(match[1]!.replaceAll(",", ""));
      const w = definition.workload, base = w.targetThroughput / (w.throughputUnit === "per-minute" ? 60 : 1);
      if (rate !== base && rate !== base * w.peakMultiplier && !exceptions.some(e => e.values.includes(String(rate)))) errors.push(`${identity} ${field}: unsupported request rate ${rate}`);
    }
  }
  if (text.some(([, prose]) => numericClaims(prose).length) &&
    !lesson.limitations.some(prose => /educational model outputs/i.test(prose))) {
    errors.push(`${identity}: numeric lab limitations must say results are educational model outputs`);
  }
  if (!lesson.experiment.evidenceToInspect?.length) errors.push(`${identity}: needs named report measurements in evidenceToInspect`);
  for (const item of lesson.experiment.evidenceToInspect ?? []) for (const label of evidenceLabels(item)) {
    if (!learningMeasurement(label)) errors.push(`${identity}: report does not render measurement ${label}`);
  }
  return errors;
}
