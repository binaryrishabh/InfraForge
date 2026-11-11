import { expect, test } from "bun:test";
import { predictionResourceIds } from "@infraforge/contracts/challenges";
import { readPrediction, choicesFor } from "../challenges/prediction";
import { validateChallengeVersions } from "../challenges/validate";
import { definition, answers, attemptRow } from "./challengeHarness";
import { buildRunReport } from "../reports/report";
import { buildRegistry, REGISTRY } from "../challenges/registry";

const base = definition("size-the-app-database-pool");
const d = {...structuredClone(base), id: "busiest-resource-probe", predictions: [{id: "where", kind: "busiest-resource" as const, prompt: "Which resource will have the highest CPU at second 6?"}]};
const ids = predictionResourceIds(d.starter!.resources, "2");
const registry = buildRegistry([...REGISTRY.all().map(e => e.definition), d]);
const run = () => attemptRow(d, d.starter!, answers(d, {where: "db"}));
const result = (row: ReturnType<typeof run>, pick: string) => buildRunReport({...row, challengePrediction: {answers: {where: pick}, reasoning: null}} as never, registry).challenge!.predictions[0]!;

test("busiest-resource offers only CPU-reporting resource ids and refuses anything else", () => {
  expect(ids).toEqual(["app", "db"]);
  expect(predictionResourceIds([{id: "lb", type: "Load Balancer"}, {id: "fw", type: "Firewall"}, {id: "app", type: "Virtual Machine"}], "2")).toEqual(["app"]);
  expect(choicesFor("busiest-resource", ["Database"], "2", ids)).toEqual(ids);
  expect(readPrediction({answers: {where: "db"}}, d, [], ids).answers.where).toBe("db");
  for (const bad of ["lb", "ghost", "Database", "DB", ""]) expect(() => readPrediction({answers: {where: bad}}, d, [], ids)).toThrow();
  expect(() => readPrediction({answers: {where: "db"}}, d, [])).toThrow();
});

test("graded from the recorded CPU; a wrong pick differs; replay of the saved row gives the same result", () => {
  const row = run(), r = buildRunReport(row, registry), p = r.challenge!.predictions[0]!;
  const cpu = Object.fromEntries(r.terminal!.resources.map(x => [x.id, x.cpu]));
  const top = cpu.app! > cpu.db! ? "app" : "db", other = top === "app" ? "db" : "app";
  expect(result(row, top)).toMatchObject({outcome: "matched", actual: top}); expect(result(row, other)).toMatchObject({outcome: "different", actual: top});
  expect(p.sources).toEqual(["terminalSnapshot.metrics", "runInputs.resources"]);
  const copy = structuredClone(row); expect(result(copy, "db")).toEqual(result(row, "db"));
});

test("ties match any tied resource; missing, stale or invalid evidence is not graded", () => {
  const row = run(), mutate = (f: (m: Record<string, {cpu?: number | null}>) => void, pick = "db") => {
    const c = structuredClone(row) as unknown as {terminalSnapshot: {metrics: Record<string, {cpu?: number | null}>}}; f(c.terminalSnapshot.metrics); return result(c as never, pick);
  };
  const tie = mutate(m => {m.app!.cpu = 50; m.db!.cpu = 50;});
  expect(tie).toMatchObject({outcome: "matched", actual: "app / db"}); expect(tie.detail).toContain("tied");
  expect(mutate(m => {m.app!.cpu = 50; m.db!.cpu = 50;}, "app").outcome).toBe("matched");
  expect(mutate(m => {delete m.db!.cpu;}).outcome).toBe("unknown");
  expect(mutate(m => {m.app!.cpu = null;}).outcome).toBe("unknown");
  expect(mutate(m => {m.app!.cpu = Number.NaN;}).outcome).toBe("unknown");
  expect(result(row, "ghost").outcome).toBe("unknown"); expect(result(row, "lb").outcome).toBe("unknown");
  const noSnapshot = {...structuredClone(row), terminalSnapshot: null} as never;
  expect(result(noSnapshot, "db").outcome).toBe("unknown");
});

test("the new kind is an allowed definition kind", () => {
  expect(validateChallengeVersions([d], {}).filter(p => p.includes("prediction"))).toEqual([]);
});
