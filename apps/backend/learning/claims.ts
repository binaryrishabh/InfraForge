import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { requestsPerSecond } from "@infraforge/domain/workload";
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
      // Audited measurement names (some carry HTTP status codes) are validated against the report vocabulary separately;
      // only free text left over after removing them is scanned for numeric claims.
      ...(lesson.experiment.evidenceToInspect ?? []).map((text, i) => [`evidence.${i}`, evidenceLabels(text).filter(label => !learningMeasurement(label)).join("; ")])] as Array<[string, string]> : []),
  ];
}

function normalizeQuantities(text: string): string {
  const words: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
    fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const quantityWords = new RegExp(`\\b((?:(?:${Object.keys(words).join("|")}|hundred|thousand)[ -]+)+)(?=(?:(?:modeled|logical|initial|app|database|worker|CPU|concurrent|maximum)\\s+)*(?:seconds?|ms|milliseconds?|cores?|keys?|entry|entries|requests?|reads?|writes?|sessions?|connections?|pools?|jobs?)\\b)`, "gi");
  return text.replace(quantityWords, phrase => {
      let total = 0, part = 0;
      for (const word of phrase.trim().toLowerCase().split(/[ -]+/).filter(Boolean)) {
        if (word === "hundred") part = (part || 1) * 100;
        else if (word === "thousand") { total += (part || 1) * 1000; part = 0; }
        else part += words[word]!;
      }
      return `${total + part} `;
    })
    .replace(/\bfourfold\b/gi, "4");
}

// SKU names are indivisible: c5.xlarge does not accidentally authorize "5".
// Percentile identifiers and Model 2 identify concepts, not measured values.
export function numericClaims(text: string): string[] {
  const normalized = normalizeQuantities(text).replace(/\b(?:p(?:50|95|99)|Model\s+2)\b/gi, "");
  return [...normalized.matchAll(
    /\b(?:[a-z]+\.)?(?:[a-z]+\d+[a-z]*\.)+[a-z\d]+\b|(?<![\w.])\d+(?:,\d{3})*(?:\.\d+)?(?![\w.])/gi,
  )].map(match => match[0].replaceAll(",", "").toLowerCase());
}

export function sizeClaims(text: string): string[] {
  return [
    ...[...text.matchAll(/\b(?:[a-z][\w-]*\.)+[\w-]+\b|\b[a-z]+-\d[\w-]+\b/gi)].map(match => match[0]),
    ...[...text.matchAll(/\b(?:Generic|Small|Medium|Large)\b/g)].map(match => match[0]),
    ...[...text.matchAll(/\b(?:select|choose|size\s+(?:from|to))\s+(small|medium|large)\b/gi)].map(match => match[1]!),
  ].filter(value => !/^second-\d+$/i.test(value)).map(value => value.toLowerCase());
}

function scenarioSeconds(definition: ChallengeDefinition): number[] {
  return (definition.scenario?.steps ?? []).flatMap(step => {
    const duration = step.request.parameters.duration;
    return typeof duration === "number" ? [step.atSecond, step.atSecond + duration] : [step.atSecond];
  });
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
  // Scenario ids, targets and revisions are not numeric evidence. Only the
  // scheduled boundaries and numeric intervention inputs authorize prose.
  scenarioSeconds(definition).forEach(second => values.add(String(second)));
  for (const step of definition.scenario?.steps ?? []) {
    for (const value of Object.values(step.request.parameters)) if (typeof value === "number") visit(value);
  }
  for (const criterion of definition.criteria) {
    for (const [key, value] of Object.entries(criterion)) if (!["id", "label", "resourceId", "kind"].includes(key)) visit(value);
  }
  for (const resource of definition.starter?.resources ?? []) {
    for (const [key, value] of Object.entries(resource)) if (!["id", "name", "type", "position", "x", "y"].includes(key)) visit(value);
  }
  const perSecond = requestsPerSecond(w);
  values.add(String(perSecond));
  values.add(String(perSecond * w.peakMultiplier));
  // Per-operation rates follow from the pinned total and read share (for example a 50/50 split of 2000/s).
  for (const share of [w.readWriteRatio, 1 - w.readWriteRatio]) values.add(String(Math.round(perSecond * share * 1e6) / 1e6));
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
    for (const [field, prose] of text) {
      const units = /\d[\d,.]*\s*(?:ms\b|milliseconds?\b|seconds?\b|s\b|req(?:uests?)?\s*\/\s*s|(?:requests?|reads?|writes?)\s*(?:\/|per|each)\s*(?:second|s)\b|cores?\b|GB\b|MB\b)/i.test(prose);
      const outcome = /\b(?:run|simulation|simulator|recorded|simulated)\b/i.test(prose) && /\d[\d,.]*\s*(?:%|callers?\b|requests?\b|completions?\b|attempts?\b)/i.test(prose);
      if (units || outcome) errors.push(`${identity} ${field}: non-executable lesson contains a digits-with-units result claim`);
    }
    return errors;
  }
  if (!definition) return errors; // Identity failures are reported by authoring.ts.
  const allowed = pinnedValues(definition);
  const seconds = new Set([definition.evaluationSeconds, ...scenarioSeconds(definition)]);
  for (const [field, prose] of text) {
    const exceptions = CLAIM_EXCEPTIONS.filter(e => e.lesson === identity && e.field === field && e.text === prose && e.reason.trim());
    const quantities = normalizeQuantities(prose);
    for (const token of new Set([...numericClaims(prose), ...sizeClaims(prose)])) if (!allowed.has(token) && !exceptions.some(e => e.values.includes(token))) {
      errors.push(`${identity} ${field}: unsupported numeric/size claim ${token}: ${prose}`);
    }
    for (const match of quantities.matchAll(/\bsecond[ -]+(\d+(?:\.\d+)?)/gi)) {
      if (!seconds.has(Number(match[1])) && !exceptions.some(e => e.values.includes(match[1]!))) {
        errors.push(`${identity} ${field}: unsupported evaluation second ${match[1]}`);
      }
    }
    for (const match of quantities.matchAll(/\bp95(?:\s+is)?\s+(?:at most|<=|≤)\s*(\d+(?:\.\d+)?)\s*ms\b/gi)) {
      if (!definition.criteria.some(criterion => criterion.kind === "terminal-p95" && criterion.maxMs === Number(match[1])) &&
        !exceptions.some(e => e.values.includes(match[1]!))) errors.push(`${identity} ${field}: unsupported p95 threshold ${match[1]} ms`);
    }
    // A number that exists as a threshold must not masquerade as a request rate.
    for (const match of quantities.matchAll(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:requests?|reads?|writes?)(?:\s*\/\s*|\s+(?:per|each)\s+)(?:second|s)\b/gi)) {
      const rate = Number(match[1]!.replaceAll(",", ""));
      const w = definition.workload, base = requestsPerSecond(w);
      const perOperation = [w.readWriteRatio, 1 - w.readWriteRatio].map(share => Math.round(base * share * 1e6) / 1e6);
      if (rate !== base && rate !== base * w.peakMultiplier && !perOperation.includes(rate) && !exceptions.some(e => e.values.includes(String(rate)))) errors.push(`${identity} ${field}: unsupported request rate ${rate}`);
    }
  }
  if (text.some(([, prose]) => numericClaims(prose).length) &&
    !lesson.limitations.some(prose => /educational model outputs/i.test(prose))) {
    errors.push(`${identity}: numeric lab limitations must say results are educational model outputs`);
  }
  if (!lesson.experiment.evidenceToInspect?.length) errors.push(`${identity}: needs named report measurements in evidenceToInspect`);
  for (const item of lesson.experiment.evidenceToInspect ?? []) for (const label of evidenceLabels(item)) {
    // Saved schema support or a live-only renderer is
    // insufficient: evidenceToInspect must name an audited saved-report label.
    if (!learningMeasurement(label)) errors.push(`${identity}: report does not render measurement ${label}`);
    else if (label.startsWith("Queue:") && !definition.criteria.some(criterion => criterion.kind === "queue-work")) {
      errors.push(`${identity}: report does not render measurement ${label} without a queue-work requirement`);
    } else if (["Monthly resource price line items", "Remaining monthly budget"].includes(label) &&
      !definition.criteria.some(criterion => criterion.kind === "monthly-budget")) {
      errors.push(`${identity}: report does not render measurement ${label} without a monthly-budget requirement`);
    }
  }
  return errors;
}
