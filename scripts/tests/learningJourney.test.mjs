import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { JOURNEY_LABS, acknowledgeJourneyChanges, answerJourneyPredictions, applyJourneyImprovement, changeJourneyControl, inspectJourneyRequirements, isLocalJourneyRequest, journeyLab } from "../qa/learning-journey.mjs";

test("the lab table has unique lesson ids, explicit controls and recorded-verdict expectations", () => {
  expect(JOURNEY_LABS.map((lab) => lab.lessonId)).toEqual([
    "where-does-the-time-go", "writes-cost-more-than-reads", "balancer-shares-turns",
    "keep-waiting-work", "check-the-missing-server", "parallel-jobs-for-a-burst", "split-the-capacity-budget", "open-and-size-an-api",
  ]);
  expect(new Set(JOURNEY_LABS.map((lab) => lab.lessonId)).size).toBe(JOURNEY_LABS.length);
  for (const lab of JOURNEY_LABS) {
    expect(lab.lessonId).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
    expect(lab.title).toBeInstanceOf(RegExp);
    expect(lab.prediction.trim().length).toBeGreaterThan(0);
    expect(lab.hypothesis.trim().length).toBeGreaterThan(0);
    expect(lab.improvement.stepName.trim().length).toBeGreaterThan(0);
    for (const control of lab.improvement.controls ?? [lab.improvement]) {
      expect(control.nodeSelector.trim().length).toBeGreaterThan(0);
      expect(control.nodeText).toBeInstanceOf(RegExp);
      expect(control.fallbackText).toBe(control.resourceId);
      expect(["radio", "spinbutton"]).toContain(control.role);
      expect(control.name).toBeInstanceOf(RegExp);
    }
    expect(lab.expected).toEqual({ starter: "Not met", improved: "Met" });
  }
});

test("omitting JOURNEY_LAB preserves the original first lab's choices", () => {
  const lab = journeyLab();
  expect(lab).toBe(JOURNEY_LABS[0]);
  expect(lab.title.test("Where does the time go?")).toBe(true);
  expect(lab.prediction).toBe("The app does three times the CPU work per read.");
  expect(lab.hypothesis).toBe("A larger app instance gives the app more CPU, so its queue should shrink and p95 should fall.");
  expect(lab.improvement.nodeSelector).toBe(".react-flow__node, [data-id]");
  expect(lab.improvement.nodeText.source).toBe("Virtual Machine");
  expect(lab.improvement.fallbackText).toBe("app");
  expect(lab.improvement.name.source).toBe("c5\\.large");
  expect(lab.improvement.stepName).toBe("the app's instance size is changed to c5.large in the designer");
});

test("database resizing and balancing target the intended resource and setting", () => {
  const db = journeyLab("writes-cost-more-than-reads").improvement;
  expect([db.resourceId, db.setting, db.from, db.to]).toEqual(["db", "skuId", null, "db.m5.large"]);
  expect(db.nodeSelector).toBe('[data-resource-id="db"]');
  expect(db.name.test("db.m5.large - 2 vCPU / 8 GB")).toBe(true); // The inspector offers catalog sizes, not the generic size field.
  expect(db.name.test("db.m5.xlarge")).toBe(false); // Neighbouring sizes in the list never count.
  const app = journeyLab("balancer-shares-turns").improvement;
  expect([app.resourceId, app.setting, app.from, app.to]).toEqual(["app-a", "skuId", null, "c5.large"]);
  expect(app.nodeSelector).toBe('[data-resource-id="app-a"]');
  expect(app.nodeSelector).not.toContain("app-b");
});

// Only selector behavior is exercised here. These doubles provide no run evidence.
function fakePage({ nodeMissing = false, controlMissing = false, groupMissing = false, failNode, storedValue } = {}) {
  const calls = [];
  let filled = "", scopeMissing = false;
  const size = {
    first() { return this; },
    async waitFor() { if (controlMissing || scopeMissing) throw new Error("requested control is missing"); },
    async check() { calls.push("checked"); },
    async fill(value) { calls.push(["filled", value]); filled = value; },
    async inputValue() { return storedValue ?? filled; },
    async isChecked() { return true; },
  };
  const page = {
    locator(selector) {
      calls.push(selector);
      return {
        filter() { return this; }, first() { return this; },
        async click() { if (nodeMissing || selector === failNode) throw new Error("node not found"); },
      };
    },
    getByText(text, options) {
      calls.push([text, options]);
      return { first() { return this; }, async click() { if (failNode) throw new Error("node fallback not found"); } };
    },
    getByRole(role, options) {
      calls.push([role, options.name.source]);
      if (role === "group") { scopeMissing = groupMissing; return { getByRole: page.getByRole }; }
      return size;
    },
  };
  return { page, calls, size };
}

test("the shared change selects app-a explicitly and keeps the original exact-text fallback", async () => {
  const balanced = fakePage();
  expect(await changeJourneyControl(balanced.page, journeyLab("balancer-shares-turns").improvement)).toBe(balanced.size);
  expect(balanced.calls).toEqual(['[data-resource-id="app-a"]', ["radio", "c5\\.large"], "checked"]);
  const original = fakePage({ nodeMissing: true });
  await changeJourneyControl(original.page, journeyLab().improvement);
  expect(original.calls).toEqual([".react-flow__node, [data-id]", ["app", { exact: true }], ["radio", "c5\\.large"], "checked"]);
});

test("a missing database size control fails rather than checking a substitute", async () => {
  const missing = fakePage({ controlMissing: true });
  await expect(changeJourneyControl(missing.page, journeyLab("writes-cost-more-than-reads").improvement)).rejects.toThrow("requested control is missing");
  expect(missing.calls).toEqual(['[data-resource-id="db"]', ["radio", "db\\.m5\\.large"]]);
});

test("the original three radio edits keep their selectors, check action and boolean detail", async () => {
  for (const lab of JOURNEY_LABS.slice(0, 3)) {
    const fake = fakePage();
    expect(await applyJourneyImprovement(fake.page, lab.improvement)).toBe(true);
    expect(fake.calls).toEqual([lab.improvement.nodeSelector, ["radio", lab.improvement.name.source], "checked"]);
    expect(lab.improvement.name.test(lab.improvement.to)).toBe(true);
  }
});

test("retention, health-check interval and worker parallelism fill the exact labelled number input", async () => {
  const cases = [
    ["keep-waiting-work", "queue", "Message Queue", "asyncQueue.retentionSeconds", "Message retention (seconds)", 1, 60],
    ["check-the-missing-server", "lb", "Load Balancer", "lbHealth.intervalSeconds", "Check interval (seconds)", 60, 1],
    ["parallel-jobs-for-a-burst", "worker", "Virtual Machine", "asyncWorker.concurrency", "Jobs in parallel", 1, 2],
  ];
  for (const [id, resourceId, type, setting, label, from, to] of cases) {
    const edit = journeyLab(id).improvement, fake = fakePage();
    expect([edit.resourceId, edit.setting, edit.from, edit.to, edit.role]).toEqual([resourceId, setting, from, to, "spinbutton"]);
    expect(edit.nodeSelector).toBe(`[data-resource-id="${resourceId}"]`);
    expect(edit.nodeText.test(type)).toBe(true);
    expect(edit.name.test(label)).toBe(true);
    expect(edit.name.test(`Other ${label}`)).toBe(false);
    expect(await applyJourneyImprovement(fake.page, edit)).toEqual([{ resourceId, setting, value: String(to) }]);
    expect(fake.calls).toEqual([edit.nodeSelector, ["spinbutton", edit.name.source], ["filled", String(to)]]);
  }
});

test("missing or unretained number controls fail without a radio or alternative setting", async () => {
  for (const id of ["keep-waiting-work", "check-the-missing-server", "parallel-jobs-for-a-burst"]) {
    const edit = journeyLab(id).improvement, missing = fakePage({ controlMissing: true });
    await expect(applyJourneyImprovement(missing.page, edit)).rejects.toThrow("requested control is missing");
    expect(missing.calls).toEqual([edit.nodeSelector, ["spinbutton", edit.name.source]]);
    const unchanged = fakePage({ storedValue: String(edit.from) });
    await expect(applyJourneyImprovement(unchanged.page, edit)).rejects.toThrow("did not retain");
  }
});

test("the budget allocation checks both DigitalOcean sizes in order using their displayed names", async () => {
  const improvement = journeyLab("split-the-capacity-budget").improvement, fake = fakePage();
  const [app, db] = improvement.controls;
  expect([app.resourceId, app.setting, app.from, app.to]).toEqual(["app", "skuId", "s-1vcpu-512mb-10gb", "s-4vcpu-8gb"]);
  expect([db.resourceId, db.setting, db.from, db.to]).toEqual(["db", "skuId", "db-s-1vcpu-1gb", "db-s-2vcpu-4gb"]);
  expect(app.name.test("Basic — 4 vCPU / 8 GB 1200 rps $48.00/mo")).toBe(true);
  expect(app.name.test("Basic — 8 vCPU / 16 GB 2400 rps $96.00/mo")).toBe(false);
  expect(db.name.test("Managed PG — 2 vCPU / 4 GB 300 qps · 250 connections $60.00/mo")).toBe(true);
  expect(db.name.test("Managed PG — 4 vCPU / 8 GB 600 qps · 400 connections $120.00/mo")).toBe(false);
  expect(await applyJourneyImprovement(fake.page, improvement)).toEqual([
    { resourceId: "app", setting: "skuId", value: true }, { resourceId: "db", setting: "skuId", value: true },
  ]);
  expect(fake.calls).toEqual([
    '[data-resource-id="app"]', ["radio", app.name.source], "checked",
    '[data-resource-id="db"]', ["radio", db.name.source], "checked",
  ]);
});

test("the mission edits only quarantine-db's scoped Priority before resizing app", async () => {
  const improvement = journeyLab("open-and-size-an-api").improvement, fake = fakePage();
  const [rule, app] = improvement.controls;
  expect([rule.resourceId, rule.setting, rule.from, rule.to]).toEqual(["fw", "firewallSettings.rules.quarantine-db.priority", 0, 20]);
  expect(rule.group.test("quarantine-db")).toBe(true);
  expect(rule.group.test("allow-app-db")).toBe(false);
  expect(rule.name.test("Priority")).toBe(true);
  expect([app.resourceId, app.setting, app.from, app.to]).toEqual(["app", "skuId", null, "c5.large"]);
  await applyJourneyImprovement(fake.page, improvement);
  expect(fake.calls).toEqual([
    '[data-resource-id="fw"]', ["group", "^quarantine-db$"], ["spinbutton", "^Priority$"], ["filled", "20"],
    '[data-resource-id="app"]', ["radio", "c5\\.large"], "checked",
  ]);
});

test("a missing quarantine-db group never falls back to another rule or app resize", async () => {
  const fake = fakePage({ groupMissing: true });
  await expect(applyJourneyImprovement(fake.page, journeyLab("open-and-size-an-api").improvement)).rejects.toThrow("requested control is missing");
  expect(fake.calls).toEqual(['[data-resource-id="fw"]', ["group", "^quarantine-db$"], ["spinbutton", "^Priority$"]]);
});

test("a missing second resource fails the combined edit instead of silently applying one setting", async () => {
  const fake = fakePage({ failNode: '[data-resource-id="db"]' });
  await expect(applyJourneyImprovement(fake.page, journeyLab("split-the-capacity-budget").improvement)).rejects.toThrow("node fallback not found");
  expect(fake.calls.filter((call) => call === "checked")).toHaveLength(1);
  expect(fake.calls.at(-1)).toEqual(["db", { exact: true }]);
});

test("unsupported control roles are refused before selecting a resource", async () => {
  const fake = fakePage();
  await expect(changeJourneyControl(fake.page, { ...journeyLab().improvement, role: "button" })).rejects.toThrow("Unsupported journey control role");
  expect(fake.calls).toEqual([]);
});

test("both budget predictions are answered in their own fieldsets; existing labs keep the first radio", async () => {
  const calls = [];
  const choice = { first() { return this; }, async check() { calls.push("checked"); } };
  const dialog = { getByRole(role, options) {
    calls.push([role, options?.name?.source]);
    return role === "group" ? { getByRole: dialog.getByRole } : choice;
  } };
  await answerJourneyPredictions(dialog, journeyLab());
  expect(calls.splice(0)).toEqual([["radio", undefined], "checked"]);
  const budget = journeyLab("split-the-capacity-budget");
  expect(budget.predictionQuestions).toHaveLength(2);
  await answerJourneyPredictions(dialog, budget);
  expect(calls).toEqual(budget.predictionQuestions.flatMap((name) => [["group", name.source], ["radio", undefined], "checked"]));
  const missing = { getByRole() { return { getByRole() { return { first() { return this; }, async check() { throw Error("missing prediction group"); } }; } }; } };
  await expect(answerJourneyPredictions(missing, budget)).rejects.toThrow("missing prediction group");
});

test("combined edits wait for and check the real multiple-change acknowledgement; single edits do not", async () => {
  const calls = [];
  const dialog = { getByRole(role, options) { calls.push([role, options]); return { async check(options) { calls.push(options); } }; } };
  for (const lab of JOURNEY_LABS) {
    await acknowledgeJourneyChanges(dialog, lab.improvement);
    expect(calls.splice(0)).toEqual(lab.improvement.controls ? [
      ["checkbox", { name: "Continue deliberately with these changes", exact: true }], { timeout: 120_000 },
    ] : []);
  }
  const missing = { getByRole() { return { async check() { throw Error("review did not offer consent"); } }; } };
  await expect(acknowledgeJourneyChanges(missing, journeyLab("open-and-size-an-api").improvement)).rejects.toThrow("review did not offer consent");
});

test("the budget journey opens the evidence record and retains the exact budget requirement row", async () => {
  const calls = [], budget = journeyLab("split-the-capacity-budget");
  expect(budget.reportRequirements[0].test("Catalog snapshot monthly estimate is at most $180")).toBe(true);
  const rowText = "selector-only row contents"; // Deliberately not run evidence or a synthetic verdict.
  const row = { first() { return this; }, async waitFor() {}, async innerText() { return rowText; } };
  const record = {
    locator(selector) { calls.push(["record", selector]); return { first() { return this; }, async click() { calls.push("opened"); } }; },
    getByRole(role) { calls.push(["record", role]); return { filter(options) { expect(options.has).toBeDefined(); return row; } }; },
  };
  const page = {
    getByText(name, options) { calls.push([name, options]); return { name }; },
    locator(selector) { calls.push(selector); return { filter(options) { expect(options.has.name).toBe("Full evidence record"); return record; } }; },
    getByRole() { throw Error("must not select the hero's requirement label without evidence detail"); },
  };
  expect(await inspectJourneyRequirements(page, journeyLab())).toEqual([]);
  expect(calls).toEqual([]);
  expect(await inspectJourneyRequirements(page, budget)).toEqual([rowText]);
  expect(calls).toEqual(["details", ["Full evidence record", { exact: true }], ["record", "summary"], "opened", ["record", "listitem"], [budget.reportRequirements[0], { exact: true }]]);
  row.waitFor = async () => { throw Error("budget row missing"); };
  await expect(inspectJourneyRequirements(page, budget)).rejects.toThrow("budget row missing");
});

test("unknown lesson selection is refused, including empty ids and inherited property names", () => {
  for (const id of ["", "no-such-lab", "constructor", "../where-does-the-time-go"]) {
    expect(() => journeyLab(id)).toThrow("Unknown JOURNEY_LAB");
  }
});

test("CLI refuses remote origins and unknown labs before loading Playwright", () => {
  const script = fileURLToPath(new URL("../qa/learning-journey.mjs", import.meta.url));
  for (const web of ["https://example.test:5173", "http://localhost.example.test:5173", "http://localhost:5173@elsewhere.test:5173", "http://localhost:5173/path"]) {
    const result = Bun.spawnSync(["node", script], {
      env: { PATH: process.env.PATH, JOURNEY_WEB: web, PW_DIR: "/missing-playwright-installation" },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("journey only runs against a localhost dev stack");
  }
  const result = Bun.spawnSync(["node", script], {
    env: { PATH: process.env.PATH, JOURNEY_LAB: "no-such-lab", PW_DIR: "/missing-playwright-installation" },
  });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("Unknown JOURNEY_LAB");
  expect(result.stderr.toString()).not.toContain("Cannot find module");
});

test("request routing permits the local web/API ports and refuses remote assets and redirects", () => {
  for (const url of ["http://localhost:5173/learn", "http://localhost:3000/api", "http://localhost:80/", "http://localhost/"]) {
    expect(isLocalJourneyRequest(url)).toBe(true);
  }
  for (const url of ["https://example.test/", "http://localhost.example.test:3000/", "http://localhost:3000@elsewhere.test/", "file:///tmp/page", "invalid"]) {
    expect(isLocalJourneyRequest(url)).toBe(false);
  }
});
