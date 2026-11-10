import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { JOURNEY_LABS, JOURNEY_LESSONS, acknowledgeJourneyChanges, answerJourneyPredictions, applyJourneyImprovement, changeJourneyControl, inspectJourneyRequirements, isLocalJourneyRequest, journeyLab, journeyLesson, selectJourney, walkJourneyLesson } from "../qa/learning-journey.mjs";
import { JOURNEY_FAILURES, installJourneyFailure, journeyFailure, localFailureApi } from "../qa/learning-journey.mjs";

test("the lab table has unique journey ids, explicit controls and recorded-verdict expectations", () => {
  // Later labs join the table, so compare the set of ids; uniqueness is asserted below.
  expect(JOURNEY_LABS.map((lab) => lab.journeyId ?? lab.lessonId).sort()).toEqual([
    "where-does-the-time-go", "writes-cost-more-than-reads", "balancer-shares-turns",
    "keep-waiting-work", "check-the-missing-server", "parallel-jobs-for-a-burst", "split-the-capacity-budget", "open-and-size-an-api",
    "writes-cost-more-than-reads-generic", "size-the-app-database-pool",
    "restore-a-database-writer",
    "move-monitoring-samples",
    "object-bytes-versus-app-cpu",
    "restore-safe-redundancy",
    "resolve-after-publication",
    "scale-on-delivered-samples",
    "isolate-route-credits",
    "redrive-after-the-fix",
    "keep-failed-events",
    "shed-load-at-the-edge",
    "share-one-origin-fetch",
    "sample-often-enough",
    "hold-slots-on-a-slow-call",
    "admit-a-replica-image",
    "keep-a-function-warm",
    "open-the-forwarding-gate",
  ].sort());
  expect(new Set(JOURNEY_LABS.map((lab) => lab.journeyId ?? lab.lessonId)).size).toBe(JOURNEY_LABS.length);
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
      expect(["radio", "spinbutton", "combobox", "switch"]).toContain(control.role);
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

test("quota journey selects only the saved scope and refuses missing or unretained controls",async()=>{
  const lab=journeyLab("isolate-route-credits"),edit=lab.improvement,fake=fakePage();
  expect([edit.resourceId,edit.setting,edit.from,edit.to]).toEqual(["gateway","gatewayQuota.scope","shared","per-route"]);
  expect(edit.name.test("Quota scope")).toBe(true);expect(edit.name.test("Other quota scope")).toBe(false);
  expect(await applyJourneyImprovement(fake.page,edit)).toEqual([{resourceId:"gateway",setting:"gatewayQuota.scope",value:"per-route"}]);
  expect(fake.calls).toEqual(['[data-resource-id="gateway"]',["combobox","^Quota scope$"],["selected","per-route"]]);
  await expect(applyJourneyImprovement(fakePage({controlMissing:true}).page,edit)).rejects.toThrow("requested control is missing");
  await expect(applyJourneyImprovement(fakePage({storedValue:"shared"}).page,edit)).rejects.toThrow("did not retain");
  expect(lab.reportRequirements[1].test("Complete at least 45 writes with no upstream failures")).toBe(true);
});

test("database resizing and balancing target the intended resource and setting", () => {
  const db = journeyLab("writes-cost-more-than-reads").improvement;
  expect([db.resourceId, db.setting, db.from, db.to]).toEqual(["db", "skuId", null, "db.m5.large"]);
  expect(db.nodeSelector).toBe('[data-resource-id="db"]');
  expect(db.name.test("db.m5.large - 2 vCPU / 8 GB")).toBe(true); // Keep the original catalog journey.
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
    async selectOption(value) { calls.push(["selected", value]); filled = value; },
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

test("the generic database journey selects Medium on the same lesson and refuses a missing control", async () => {
  const lab = journeyLab("writes-cost-more-than-reads-generic"), edit = lab.improvement;
  expect(lab.lessonId).toBe("writes-cost-more-than-reads");
  expect([edit.resourceId, edit.setting, edit.from, edit.to]).toEqual(["db", "size", "small", "medium"]);
  expect(edit.name.test("Generic Medium 2 assumed cores · 4 GB assumed memory")).toBe(true);
  for (const label of ["Generic Small", "Generic Large", "db.m5.large", "Other Generic Medium"]) expect(edit.name.test(label)).toBe(false);
  const fake = fakePage();
  expect(await applyJourneyImprovement(fake.page, edit)).toBe(true);
  expect(fake.calls).toEqual(['[data-resource-id="db"]', ["radio", "^Generic Medium\\b"], "checked"]);
  const missing = fakePage({ controlMissing: true });
  await expect(changeJourneyControl(missing.page, edit)).rejects.toThrow("requested control is missing");
  expect(missing.calls).toEqual(['[data-resource-id="db"]', ["radio", "^Generic Medium\\b"]]);
  expect(journeyLab("writes-cost-more-than-reads").improvement.to).toBe("db.m5.large");
  expect(selectJourney({ JOURNEY_LAB: lab.journeyId })).toEqual({ kind: "lab", entry: lab });
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
    locator(selector, options) {
      if (selector === "summary") { calls.push(["summary", options.hasText]); return { summary: true }; }
      calls.push(selector);
      return { filter(o) { expect(o.has.summary).toBe(true); return record; } };
    },
    getByRole() { throw Error("must not select the hero's requirement label without evidence detail"); },
  };
  expect(await inspectJourneyRequirements(page, journeyLab())).toEqual([]);
  expect(calls).toEqual([]);
  expect(await inspectJourneyRequirements(page, budget)).toEqual([rowText]);
  expect(calls).toEqual(["details", ["summary", "Full evidence record"], ["record", "summary"], "opened", ["record", "listitem"], [budget.reportRequirements[0], { exact: true }]]);
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

// Selector doubles only: no browser, storage, server progress or run evidence is produced.
function fakeLessonPage(lesson, faults = {}) {
  const calls = [], steps = [];
  let answer = null, read = false, reloaded = false;
  const path = (entry) => `/learn/lessons/${entry.lessonId}`;
  const role = (scope, name, options = {}) => {
    calls.push({ scope, role: name, ...options });
    const label = options.name;
    const locator = {
      async waitFor() {
        if (faults.missingRole !== undefined && faults.missingRole === label) throw Error("named control missing");
        if (name === "heading" && ![lesson.title, lesson.next.title, "Problem", "Plain explanation", "Prediction prompt", "Limitations", "Follow-up", "Check question"].includes(label)) throw Error("wrong heading selector");
        if (["radio", "link", "button", "group", "complementary"].includes(name) && options.exact !== true) throw Error("control name must be exact");
        if (name === "button" && label === "Remove read mark" && (!read || reloaded && faults.lostRead)) throw Error("read mark missing");
        if (name === "status" && !locator.feedback) throw Error("feedback must be scoped and selected by its explanation");
      },
      async count() {
        if (name === "link" && scope === "prerequisites") return lesson.prerequisites.length + (faults.extraPrerequisite ? 1 : 0);
        if (name === "radio") return lesson.check ? 2 : faults.unexpectedRadio ? 1 : 0;
        if (name === "button" && label === "Open challenge lab") return faults.labClaim ? 1 : 0;
        return 0;
      },
      async getAttribute(attribute) {
        if (attribute === "aria-pressed") return faults.unpressed ? "false" : "true";
        if (attribute !== "href") throw Error("unexpected attribute");
        if (faults.wrongHref === label) return "/learn/lessons/wrong-target";
        if (scope === "prerequisites") {
          const prerequisite = lesson.prerequisites.find(p => p.title === label);
          if (!prerequisite) throw Error("wrong prerequisite selector");
          return path(prerequisite);
        }
        return label === lesson.title ? path(lesson) : path(lesson.next);
      },
      async check() {
        await locator.waitFor();
        if (scope !== "check" || ![lesson.check?.wrong, lesson.check?.correct].includes(label)) throw Error("wrong or unscoped answer selector");
        calls.push({ action: "check", name: label });
        answer = label;
      },
      async isChecked() { return answer === label && !(reloaded && faults.lostAnswer) && !faults.unchecked; },
      async click() {
        await locator.waitFor();
        calls.push({ action: "click", name: label });
        if (name === "button") {
          if (label !== "Mark as read") throw Error("wrong read control");
          read = true;
        }
      },
      filter({ hasText }) {
        if (scope !== "check" || name !== "status") throw Error("unscoped feedback");
        const expected = `${answer === lesson.check.correct ? "That matches the explanation. " : "Revisit the explanation. "}${lesson.check.explanation}`;
        if (hasText !== expected) throw Error("wrong feedback selector");
        calls.push({ action: "feedback", text: hasText, reloaded });
        locator.feedback = true;
        if (faults.missingFeedback === (answer === lesson.check.correct ? "matching" : "revisit")) locator.waitFor = async () => { throw Error("feedback missing"); };
        return locator;
      },
      getByRole(nestedRole, nestedOptions) { return role(name === "group" ? "check" : "prerequisites", nestedRole, nestedOptions); },
      getByText(text, textOptions) { return textLocator(text, textOptions, "prerequisites"); },
    };
    return locator;
  };
  const textLocator = (text, options = {}, scope = "page") => {
    calls.push({ scope, text, ...options });
    return {
      async waitFor() {
        if (faults.missingText === text) throw Error("expected lesson text missing");
        if (options.exact !== true) throw Error("lesson text must match exactly");
      },
      async count() { return faults.serverClaim ? 1 : 0; },
    };
  };
  const page = {
    getByRole(name, options) { return role("page", name, options); },
    getByText: textLocator,
    async goto(url) { calls.push({ action: "goto", url }); },
    async waitForURL(url) { calls.push({ action: "url", url }); },
    async reload() { reloaded = true; calls.push({ action: "reload" }); },
    async screenshot() {},
  };
  const options = { web: "http://localhost:5173", shots: "/unused-selector-shots", async step(name, fn) { steps.push(name); await fn(); } };
  return { page, calls, steps, options };
}

test("the lesson matrix samples five conceptual tracks and one no-check reading", () => {
  expect(JOURNEY_LESSONS.map(l => l.lessonId)).toEqual([
    "client-and-server", "count-waiting-jobs", "missing-failure-observations", "choose-the-constrained-tier", "locate-the-missing-wait", "what-is-a-request",
  ]);
  expect(new Set(JOURNEY_LESSONS.map(l => l.lessonId)).size).toBe(6);
  expect(JOURNEY_LESSONS.filter(l => l.check).map(l => l.trackId)).toEqual(["foundations", "async", "failures", "scaling", "diagnosis"]);
  for (const lesson of JOURNEY_LESSONS) {
    expect(lesson.limitations.length).toBeGreaterThan(0);
    expect(lesson.next.lessonId).not.toBe(lesson.lessonId);
    expect(lesson.next.title.length).toBeGreaterThan(0);
    expect(journeyLesson(lesson.lessonId)).toBe(lesson);
    if (lesson.check) {
      expect(lesson.kind).toBe("conceptual-exercise");
      expect(lesson.check.wrong).not.toBe(lesson.check.correct);
      expect(lesson.check.explanation.length).toBeGreaterThan(0);
    } else expect(lesson.kind).toBe("reading");
  }
});

test("selection defaults to the unchanged lab path and explicitly selects lesson mode", () => {
  expect(selectJourney()).toEqual({ kind: "lab", entry: journeyLab() });
  expect(selectJourney({ JOURNEY_KIND: "lesson" })).toEqual({ kind: "lesson", entry: journeyLesson() });
  for (const lab of JOURNEY_LABS) expect(selectJourney({ JOURNEY_LAB: lab.journeyId ?? lab.lessonId })).toEqual({ kind: "lab", entry: lab });
  for (const lesson of JOURNEY_LESSONS) expect(selectJourney({ JOURNEY_KIND: "lesson", JOURNEY_LESSON: lesson.lessonId })).toEqual({ kind: "lesson", entry: lesson });
  for (const id of ["", "constructor", "../client-and-server", "unknown"]) expect(() => journeyLesson(id)).toThrow("Unknown JOURNEY_LESSON");
  for (const kind of ["", "reading", "constructor"]) expect(() => selectJourney({ JOURNEY_KIND: kind })).toThrow("Unknown JOURNEY_KIND");
  expect(() => selectJourney({ JOURNEY_LESSON: "client-and-server" })).toThrow("requires JOURNEY_KIND=lesson");
  expect(() => selectJourney({ JOURNEY_KIND: "lesson", JOURNEY_LAB: "where-does-the-time-go" })).toThrow("cannot be combined");
});

test("every conceptual lesson uses named list/prerequisite links, scoped wrong/right radios and the next link", async () => {
  for (const lesson of JOURNEY_LESSONS.filter(l => l.check)) {
    const fake = fakeLessonPage(lesson);
    await walkJourneyLesson(fake.page, lesson, fake.options);
    expect(fake.steps).toHaveLength(7);
    expect(fake.calls.filter(c => c.action === "check").map(c => c.name)).toEqual([lesson.check.wrong, lesson.check.correct]);
    expect(fake.calls.filter(c => c.action === "feedback").map(c => [c.text, c.reloaded])).toEqual([
      [`Revisit the explanation. ${lesson.check.explanation}`, false],
      [`That matches the explanation. ${lesson.check.explanation}`, false],
      [`That matches the explanation. ${lesson.check.explanation}`, true],
    ]);
    expect(fake.calls.filter(c => c.action === "click").map(c => c.name)).toEqual([lesson.title, "Mark as read", `Next in track order: ${lesson.next.title}`]);
    expect(fake.calls.filter(c => c.scope === "prerequisites" && c.role === "link" && c.name).map(c => c.name)).toEqual(lesson.prerequisites.map(p => p.title));
    expect(fake.calls.filter(c => c.text && lesson.limitations.includes(c.text)).map(c => c.text)).toEqual(lesson.limitations);
    expect(fake.calls.filter(c => c.action === "url").map(c => c.url)).toEqual([`http://localhost:5173/learn/lessons/${lesson.lessonId}`, `http://localhost:5173/learn/lessons/${lesson.next.lessonId}`]);
    expect(fake.calls.some(c => c.role === "radio" && c.scope !== "check")).toBe(false);
  }
});

test("the no-check reading asserts its message before and after reload without choosing a radio", async () => {
  const lesson = journeyLesson("what-is-a-request"), fake = fakeLessonPage(lesson);
  await walkJourneyLesson(fake.page, lesson, fake.options);
  expect(fake.steps).toHaveLength(6);
  expect(fake.calls.filter(c => c.text === "This lesson has no check question. Try explaining the problem in your own words.")).toHaveLength(2);
  expect(fake.calls.filter(c => c.action === "check" || c.action === "feedback")).toEqual([]);
  expect(fake.calls.filter(c => c.action === "click").map(c => c.name)).toEqual([lesson.title, "Mark as read", "Next in track order: Client and server"]);
});

test("missing accessible controls, prerequisite targets or next targets fail without selector fallbacks", async () => {
  const lesson = journeyLesson();
  for (const faults of [
    { missingRole: lesson.title }, { missingRole: lesson.check.wrong }, { missingRole: lesson.check.correct },
    { missingRole: "Mark as read" }, { missingRole: lesson.prerequisites[0].title },
    { wrongHref: lesson.title }, { wrongHref: lesson.prerequisites[0].title },
    { wrongHref: `Next in track order: ${lesson.next.title}` }, { extraPrerequisite: true },
  ]) {
    const fake = fakeLessonPage(lesson, faults);
    await expect(walkJourneyLesson(fake.page, lesson, fake.options)).rejects.toThrow();
  }
});

test("missing limitations, feedback or saved-note text fails instead of reporting success", async () => {
  const lesson = journeyLesson();
  for (const faults of [
    { missingText: lesson.limitations[0] }, { missingFeedback: "revisit" }, { missingFeedback: "matching" },
    { missingText: "Reading mark and check answers: saved on this device. These are personal notes, not server progress or mastery." },
  ]) {
    const fake = fakeLessonPage(lesson, faults);
    await expect(walkJourneyLesson(fake.page, lesson, fake.options)).rejects.toThrow();
  }
});

test("unselected answers, unpressed read marks and lost reload state fail", async () => {
  const lesson = journeyLesson();
  for (const faults of [{ unchecked: true }, { unpressed: true }, { lostAnswer: true }, { lostRead: true }]) {
    const fake = fakeLessonPage(lesson, faults);
    await expect(walkJourneyLesson(fake.page, lesson, fake.options)).rejects.toThrow();
  }
});

test("a conceptual lesson cannot silently expose a lab or server progress claim", async () => {
  for (const faults of [{ labClaim: true }, { serverClaim: true }]) {
    const lesson = journeyLesson(), fake = fakeLessonPage(lesson, faults);
    await expect(walkJourneyLesson(fake.page, lesson, fake.options)).rejects.toThrow("lab or server activity claim");
  }
});

test("a no-check reading fails when its message is missing or it exposes answers", async () => {
  const lesson = journeyLesson("what-is-a-request");
  for (const faults of [{ missingText: "This lesson has no check question. Try explaining the problem in your own words." }, { unexpectedRadio: true }]) {
    const fake = fakeLessonPage(lesson, faults);
    await expect(walkJourneyLesson(fake.page, lesson, fake.options)).rejects.toThrow();
  }
});

test("lesson CLI refuses invalid selectors and remote origins before loading Playwright", () => {
  const script = fileURLToPath(new URL("../qa/learning-journey.mjs", import.meta.url));
  const cases = [
    [{ JOURNEY_KIND: "unknown" }, "Unknown JOURNEY_KIND"],
    [{ JOURNEY_KIND: "lesson", JOURNEY_LESSON: "unknown" }, "Unknown JOURNEY_LESSON"],
    [{ JOURNEY_LESSON: "client-and-server" }, "requires JOURNEY_KIND=lesson"],
    [{ JOURNEY_KIND: "lesson", JOURNEY_LAB: "where-does-the-time-go" }, "cannot be combined"],
    [{ JOURNEY_KIND: "lesson", JOURNEY_WEB: "https://example.test:5173" }, "journey only runs against a localhost dev stack"],
  ];
  for (const [env, error] of cases) {
    const result = Bun.spawnSync(["node", script], { env: { PATH: process.env.PATH, PW_DIR: "/missing-playwright-installation", ...env } });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain(error);
    expect(result.stderr.toString()).not.toContain("Cannot find module");
  }
});

// These fake pages prove ONLY the case selectors, exact request matching and
// interception bookkeeping. They are NOT proof that any product page behaves.
function fakeFailureRoutes() {
  const registrations = [], removals = [], actions = [], requests = [];
  const page = {
    async route(pattern, handler) { registrations.push({ pattern, handler }); },
    async unroute(pattern, handler) { removals.push({ pattern, handler }); },
  };
  const request = (url, method = "GET", origin = "http://localhost:5173") => ({ url: () => url, method: () => method, headers: () => ({ origin }) });
  return { page, registrations, removals, actions, request, requests,
    async dispatch(url, method, origin) {
      const current = request(url, method, origin); requests.push(current);
      const route = { request: () => current,
        async fallback() { actions.push({ action: "fallback" }); },
        async abort(reason) { actions.push({ action: "abort", reason }); },
        async fulfill(response) { actions.push({ action: "fulfill", ...response }); },
      };
      await registrations.at(-1).handler(route);
      return actions.at(-1);
    },
  };
}

test("failure selection covers the required paths without changing default lab or lesson selection", () => {
  expect(JOURNEY_FAILURES.map(row => row.id)).toEqual([
    "lesson-list-load", "lesson-open-load", "check-session-expired", "run-start-refused", "run-start-error",
    "run-start-session-expired", "reload-mid-run", "browser-input-load", "run-delivery-busy",
  ]);
  expect(new Set(JOURNEY_FAILURES.map(row => row.id)).size).toBe(JOURNEY_FAILURES.length);
  expect(selectJourney({ JOURNEY_KIND: "failure" })).toEqual({ kind: "failure", entry: JOURNEY_FAILURES[0] });
  expect(selectJourney()).toEqual({ kind: "lab", entry: journeyLab() });
  expect(selectJourney({ JOURNEY_KIND: "lesson" })).toEqual({ kind: "lesson", entry: journeyLesson() });
  for (const row of JOURNEY_FAILURES) {
    expect(journeyFailure(row.id)).toBe(row);
    expect(selectJourney({ JOURNEY_KIND: "failure", JOURNEY_FAILURE: row.id })).toEqual({ kind: "failure", entry: row });
    expect(row.recovery.length).toBeGreaterThan(0);
    if (row.path) expect(["abort", 500, 401, 429]).toContain(row.status);
    else expect(row).toMatchObject({ flow: "reload", method: null, status: null, recovery: "Start it again" });
  }
  expect(journeyFailure("lesson-list-load")).toMatchObject({ method: "GET", path: "/learning", alert: "Learning could not be loaded. Try again.", recovery: "Try again" });
  expect(journeyFailure("lesson-open-load")).toMatchObject({ method: "GET", path: "/learning/lessons/client-and-server", status: "abort", recovery: "Try again" });
  expect(journeyFailure("check-session-expired")).toMatchObject({ method: "GET", path: "/learning", status: 401, recovery: "Sign in" });
  for (const id of ["", "constructor", "../lesson-list-load", "unknown"]) expect(() => journeyFailure(id)).toThrow("Unknown JOURNEY_FAILURE");
  expect(() => selectJourney({ JOURNEY_FAILURE: "lesson-list-load" })).toThrow("requires JOURNEY_KIND=failure");
  for (const key of ["JOURNEY_LAB", "JOURNEY_LESSON"]) expect(() => selectJourney({ JOURNEY_KIND: "failure", [key]: "anything" })).toThrow("cannot be combined");
});

test("each registered injection matches its local API method/path and records only the injected failure", async () => {
  for (const row of JOURNEY_FAILURES.filter(row => row.path)) {
    const fake = fakeFailureRoutes(), injection = await installJourneyFailure(fake.page, row);
    expect(fake.registrations[0].pattern).toBe("**/*");
    expect(() => injection.assertInjected()).toThrow("was not exercised");
    const path = typeof row.path === "string" ? row.path : row.flow === "delivery" ? "/deployments/run-1/submit" : "/deployments/run-1/browser-run";
    const url = `http://localhost:3000/api${path}?version=1`;
    const response = await fake.dispatch(url, row.method);
    if (row.status === "abort") expect(response).toEqual({ action: "abort", reason: "failed" });
    else {
      expect(response).toMatchObject({ action: "fulfill", status: row.status, contentType: "application/json" });
      expect(JSON.parse(response.body)).toEqual({ message: row.message });
      expect(response.headers).toEqual({ "access-control-allow-origin": "http://localhost:5173", "access-control-allow-credentials": "true", vary: "Origin" });
    }
    expect(injection.injected).toEqual([{ url, method: row.method, status: row.status }]);
    injection.assertInjected();
    injection.release();
    expect(await fake.dispatch(url, row.method)).toEqual({ action: "fallback" });
    expect(injection.injected).toHaveLength(1);
    await injection.dispose();
    expect(fake.removals).toEqual(fake.registrations);
  }
});

test("the page interceptor also refuses remote origins and preserves the context guard via fallback", async () => {
  const fake = fakeFailureRoutes(), injection = await installJourneyFailure(fake.page, journeyFailure());
  for (const url of ["https://localhost:3000/api/learning", "http://127.0.0.1:3000/api/learning", "http://localhost.example.test:3000/api/learning", "https://example.test/api/learning"]) {
    expect(await fake.dispatch(url)).toEqual({ action: "abort", reason: "blockedbyclient" });
  }
  for (const [url, method] of [
    ["http://localhost:3001/api/learning", "GET"], ["http://localhost:5173/api/learning", "GET"],
    ["http://localhost:3000/apix/learning", "GET"], ["http://localhost:3000/api/learning/lessons/client-and-server", "GET"],
    ["http://localhost:3000/api/learning/", "GET"], ["http://localhost:3000/api/auth/get-session", "GET"],
    ["http://localhost:3000/api/learning", "POST"], ["http://localhost:3000/api/learning", "OPTIONS"],
  ]) expect(await fake.dispatch(url, method)).toEqual({ action: "fallback" });
  expect(injection.injected).toEqual([]);
});

test("dynamic deployment selectors do not intercept other endpoints or nested paths", async () => {
  for (const id of ["browser-input-load", "run-delivery-busy"]) {
    const row = journeyFailure(id), fake = fakeFailureRoutes();
    const injection = await installJourneyFailure(fake.page, row);
    for (const path of ["/deployments/run-1", "/deployments/run-1/report", "/deployments/run-1/cancel", "/deployments/run-1/submit/extra", "/deployments/run-1/browser-run/extra"]) {
      expect(await fake.dispatch(`http://localhost:3000/api${path}`, row.method)).toEqual({ action: "fallback" });
    }
    expect(injection.injected).toEqual([]);
  }
});

test("expiry interception can be armed after the lesson and its catalogue finish loading", async () => {
  const fake = fakeFailureRoutes(), row = journeyFailure("check-session-expired");
  const injection = await installJourneyFailure(fake.page, row, undefined, { armed: false });
  const url = "http://localhost:3000/api/learning";
  expect(await fake.dispatch(url)).toEqual({ action: "fallback" });
  expect(injection.injected).toEqual([]);
  injection.arm();
  expect(await fake.dispatch(url)).toMatchObject({ action: "fulfill", status: 401 });
  injection.assertInjected();
  injection.release();
  expect(await fake.dispatch(url)).toEqual({ action: "fallback" });
});

test("failure attribution requires an actually injected URL, method/status and exact resource error", async () => {
  const fake = fakeFailureRoutes(), injection = await installJourneyFailure(fake.page, journeyFailure());
  const url = "http://localhost:3000/api/learning";
  const response = (value = url, status = 500, method = "GET", request = fake.requests.find(r => r.url() === value && r.method() === method) ?? fake.request(value, method)) => ({ url: () => value, status: () => status, request: () => request });
  const message = (value = url, text = "Failed to load resource: the server responded with a status of 500 (Internal Server Error)") => ({ location: () => ({ url: value }), text: () => text });
  expect(injection.expectedResponse(response())).toBe(false);
  expect(injection.expectedConsole(message())).toBe(false);
  await fake.dispatch(url);
  expect(injection.expectedResponse(response())).toBe(true);
  expect(injection.expectedConsole(message())).toBe(true);
  expect(injection.expectedConsole(message())).toBe(false); // no blanket URL suppression
  for (const other of [response(`${url}/lessons`), response(url, 401), response(url, 500, "POST")]) expect(injection.expectedResponse(other)).toBe(false);
  for (const other of [message(`${url}/lessons`), message(url, "application crashed"), message(url, "Failed to load resource: net::ERR_FAILED")]) expect(injection.expectedConsole(other)).toBe(false);
  injection.release();
  await fake.dispatch(url);
  expect(injection.expectedResponse(response(url, 500, "GET", fake.requests.at(-1)))).toBe(false); // a genuine failure after release is unexpected
  const aborted = fakeFailureRoutes(), abortInjection = await installJourneyFailure(aborted.page, journeyFailure("lesson-open-load"));
  const abortUrl = `${url}/lessons/client-and-server`;
  await aborted.dispatch(abortUrl);
  expect(abortInjection.expectedConsole(message(abortUrl, "Failed to load resource: net::ERR_FAILED"))).toBe(true);
});

test("only registered rows and explicitly local API bases can be injected", async () => {
  expect(localFailureApi()).toBe("http://localhost:3000/api");
  const fake = fakeFailureRoutes();
  for (const api of ["https://localhost:3000/api", "http://localhost.example.test:3000/api", "http://localhost:3000/api/", "http://localhost:3000/api?redirect=remote", "http://user@localhost:3000/api"]) {
    await expect(installJourneyFailure(fake.page, journeyFailure(), api)).rejects.toThrow("localhost API");
  }
  await expect(installJourneyFailure(fake.page, { ...journeyFailure(), path: "/auth" })).rejects.toThrow("registered");
  expect(fake.registrations).toEqual([]);
  await installJourneyFailure(fake.page, journeyFailure(), "http://localhost:4000/api");
  const response = await fake.dispatch("http://localhost:4000/api/learning", "GET", "http://localhost:5555");
  expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5555");
  const untrusted = await fake.dispatch("http://localhost:4000/api/learning", "GET", "https://example.test");
  expect(untrusted.headers).toEqual({});
});

test("failure CLI rejects bad selections and remote API/web origins before loading Playwright", () => {
  const script = fileURLToPath(new URL("../qa/learning-journey.mjs", import.meta.url));
  for (const [env, error] of [
    [{ JOURNEY_FAILURE: "lesson-list-load" }, "requires JOURNEY_KIND=failure"],
    [{ JOURNEY_KIND: "failure", JOURNEY_FAILURE: "unknown" }, "Unknown JOURNEY_FAILURE"],
    [{ JOURNEY_KIND: "failure", JOURNEY_LAB: "where-does-the-time-go" }, "cannot be combined"],
    [{ JOURNEY_KIND: "failure", JOURNEY_LESSON: "client-and-server" }, "cannot be combined"],
    [{ JOURNEY_KIND: "failure", JOURNEY_API: "https://example.test/api" }, "localhost API"],
    [{ JOURNEY_KIND: "failure", JOURNEY_WEB: "https://example.test:5173" }, "localhost dev stack"],
  ]) {
    const result = Bun.spawnSync(["node", script], { env: { PATH: process.env.PATH, PW_DIR: "/missing-playwright-installation", ...env } });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain(error);
    expect(result.stderr.toString()).not.toContain("Cannot find module");
  }
});


test("object byte capacity journey selects the store control and refuses missing or unretained values", async () => {
  const lab = journeyLab("object-bytes-versus-app-cpu"), edit = lab.improvement;
  expect([edit.resourceId, edit.setting, edit.from, edit.to]).toEqual(["store", "objectStoragePolicy.capacityMiB", 1, 4]);
  expect(edit.nodeText.test("Object Storage")).toBe(true);
  expect(edit.name.test("Stored data capacity (MiB)")).toBe(true);
  for (const name of ["Object stored bytes", "Stored data capacity (MB)", "Jobs in parallel", "Other Stored data capacity (MiB)"]) expect(edit.name.test(name)).toBe(false);
  const fake = fakePage();
  expect(await applyJourneyImprovement(fake.page, edit)).toEqual([{resourceId: "store", setting: edit.setting, value: "4"}]);
  expect(fake.calls).toEqual(['[data-resource-id="store"]', ["spinbutton", "^Stored data capacity \\(MiB\\)$"], ["filled", "4"]]);
  await expect(applyJourneyImprovement(fakePage({controlMissing: true}).page, edit)).rejects.toThrow("requested control is missing");
  await expect(applyJourneyImprovement(fakePage({storedValue: "1"}).page, edit)).rejects.toThrow("did not retain");
  expect(selectJourney({JOURNEY_LAB: lab.lessonId})).toEqual({kind: "lab", entry: lab});
  expect(lab.reportRequirements[0].test("Complete at least 1100 callers; no unsuccessful callers")).toBe(true);
});

test("application database pool journey fills the exact numeric control and refuses missing or unretained values", async () => {
  const lab = journeyLab("size-the-app-database-pool"), edit = lab.improvement;
  expect([edit.resourceId, edit.setting, edit.from, edit.to]).toEqual(["db", "dbPoolMaxConnections", 1, 2]);
  expect(edit.name.test("Application database connections")).toBe(true);
  for (const name of ["Active queries", "Queued queries", "Connections"]) expect(edit.name.test(name)).toBe(false);
  const fake = fakePage();
  expect(await applyJourneyImprovement(fake.page, edit)).toEqual([{resourceId: "db", setting: "dbPoolMaxConnections", value: "2"}]);
  expect(fake.calls).toEqual(['[data-resource-id="db"]', ["spinbutton", "^Application database connections$"], ["filled", "2"]]);
  await expect(applyJourneyImprovement(fakePage({controlMissing: true}).page, edit)).rejects.toThrow("requested control is missing");
  await expect(applyJourneyImprovement(fakePage({storedValue: "1"}).page, {controls: [edit]})).rejects.toThrow("Journey control did not retain");
  expect(selectJourney({JOURNEY_LAB: lab.lessonId})).toEqual({kind: "lab", entry: lab});
});

test("database incident journey performs the saved promotion change through the labelled control", async () => {
  const lab = journeyLab("restore-a-database-writer"), edit = lab.improvement;
  expect([edit.resourceId, edit.setting, edit.from, edit.to]).toEqual(["db", "databaseRecoveryPlan.promoteAtSecond", null, 3]);
  const fake = fakePage();
  expect(await applyJourneyImprovement(fake.page, edit)).toEqual([{resourceId: "db", setting: "databaseRecoveryPlan.promoteAtSecond", value: "3"}]);
  expect(fake.calls).toEqual(['[data-resource-id="db"]', ["spinbutton", "^Promote at simulated second$"], ["filled", "3"]]);
  expect(lab.reportRequirements[0].test("Complete at least 110 callers; at most 30 unsuccessful")).toBe(true);
  await expect(applyJourneyImprovement(fakePage({controlMissing: true}).page, edit)).rejects.toThrow("requested control is missing");
  await expect(applyJourneyImprovement(fakePage({storedValue: "8"}).page, edit)).rejects.toThrow("did not retain");
});

test("monitoring journey changes the batch spinbutton and refuses missing or unretained values", async () => {
  const lab=journeyLab("move-monitoring-samples"),edit=lab.improvement;
  expect([edit.resourceId,edit.setting,edit.from,edit.to]).toEqual(["monitor","monitoringPolicy.batchSamples",1,16]);
  expect(edit.name.test("Export batch size")).toBe(true);
  for(const label of ["Buffered samples","Export attempts","Export every (seconds)"]) expect(edit.name.test(label)).toBe(false);
  const fake=fakePage();
  expect(await applyJourneyImprovement(fake.page,edit)).toEqual([{resourceId:"monitor",setting:"monitoringPolicy.batchSamples",value:"16"}]);
  expect(fake.calls).toEqual(['[data-resource-id="monitor"]',["spinbutton","^Export batch size$"],["filled","16"]]);
  await expect(applyJourneyImprovement(fakePage({controlMissing:true}).page,edit)).rejects.toThrow("requested control is missing");
  await expect(applyJourneyImprovement(fakePage({storedValue:"1"}).page,edit)).rejects.toThrow("did not retain");
  expect(lab.reportRequirements[0].test("Receive 128 samples without drops or duplicates; backend ages at most 10 seconds")).toBe(true);
});

test("delivered-samples journey changes the export interval and refuses missing or unretained values", async () => {
  const lab=journeyLab("scale-on-delivered-samples"),edit=lab.improvement;
  expect([edit.resourceId,edit.setting,edit.from,edit.to]).toEqual(["monitor","monitoringPolicy.exportIntervalSeconds",20,2]);
  expect(edit.name.test("Export every (seconds)")).toBe(true);
  for(const label of ["Export batch size","Collect every (seconds)","Buffered samples"]) expect(edit.name.test(label)).toBe(false);
  const fake=fakePage();
  expect(await applyJourneyImprovement(fake.page,edit)).toEqual([{resourceId:"monitor",setting:"monitoringPolicy.exportIntervalSeconds",value:"2"}]);
  await expect(applyJourneyImprovement(fakePage({controlMissing:true}).page,edit)).rejects.toThrow("requested control is missing");
  await expect(applyJourneyImprovement(fakePage({storedValue:"20"}).page,edit)).rejects.toThrow("did not retain");
  expect(lab.reportRequirements[0].test("The pool has at least 2 app servers in service at second 90")).toBe(true);
});

test("redrive journey changes the redrive second and refuses missing or unretained values", async () => {
  const lab=journeyLab("redrive-after-the-fix"),edit=lab.improvement;
  expect([edit.resourceId,edit.setting,edit.from,edit.to]).toEqual(["queue","asyncQueue.redriveAtSecond",20,45]);
  expect(edit.name.test("Redrive dead-lettered messages at second")).toBe(true);
  expect(edit.name.test("Maximum deliveries before dead-lettering")).toBe(false);
  expect(await applyJourneyImprovement(fakePage().page,edit)).toEqual([{resourceId:"queue",setting:"asyncQueue.redriveAtSecond",value:"45"}]);
  await expect(applyJourneyImprovement(fakePage({controlMissing:true}).page,edit)).rejects.toThrow("requested control is missing");
  await expect(applyJourneyImprovement(fakePage({storedValue:"20"}).page,edit)).rejects.toThrow("did not retain");
});

test("failed-events journey changes the dead-letter size and refuses missing or unretained values", async () => {
  const lab=journeyLab("keep-failed-events"),edit=lab.improvement;
  expect([edit.resourceId,edit.setting,edit.from,edit.to]).toEqual(["bus","eventBus.deadLetterCapacity",5,100]);
  expect(edit.name.test("Dead letters per subscription")).toBe(true);
  expect(edit.name.test("Delivery attempts")).toBe(false);
  expect(await applyJourneyImprovement(fakePage().page,edit)).toEqual([{resourceId:"bus",setting:"eventBus.deadLetterCapacity",value:"100"}]);
  await expect(applyJourneyImprovement(fakePage({controlMissing:true}).page,edit)).rejects.toThrow("requested control is missing");
  await expect(applyJourneyImprovement(fakePage({storedValue:"5"}).page,edit)).rejects.toThrow("did not retain");
});

test("origin-fetch journey turns the coalescing switch on and refuses missing or unretained values", async () => {
  const lab=journeyLab("share-one-origin-fetch"),edit=lab.improvement;
  expect([edit.resourceId,edit.setting,edit.role]).toEqual(["cdn","cdnCachePolicy.coalesce","switch"]);
  const make=(checked, missing=false)=>{ const calls=[]; let state=checked;
    const control={waitFor:async()=>{ if(missing) throw new Error("requested control is missing"); }, isChecked:async()=>state, click:async()=>{ calls.push("click"); state=true; }};
    const scope={getByRole:(role,opts)=>{ calls.push([role,opts.name.source]); return {first:()=>control}; }};
    const node={filter:()=>({first:()=>({click:async()=>{}})})};
    return {calls,page:{locator:()=>node,getByText:()=>({first:()=>({click:async()=>{}})}),getByRole:scope.getByRole}}; };
  const fake=make(false);
  expect(await applyJourneyImprovement(fake.page,edit)).toEqual([{resourceId:"cdn",setting:"cdnCachePolicy.coalesce",value:true}]);
  expect(fake.calls).toEqual([["switch","^Coalesce concurrent misses$"],"click"]);
  const on=make(true); await applyJourneyImprovement(on.page,edit); expect(on.calls).toEqual([["switch","^Coalesce concurrent misses$"]]);
  await expect(applyJourneyImprovement(make(false,true).page,edit)).rejects.toThrow("requested control is missing");
  expect(lab.reportRequirements[0].test("At most 90 origin requests by second 60 with a TTL of one second or less")).toBe(true);
});

test("sample journey changes the collection interval and refuses missing or unretained values", async () => {
  const lab=journeyLab("sample-often-enough"),edit=lab.improvement;
  expect([edit.resourceId,edit.setting,edit.from,edit.to]).toEqual(["monitor","monitoringPolicy.collectionIntervalSeconds",20,2]);
  expect(edit.name.test("Collect every (seconds)")).toBe(true);
  expect(edit.name.test("Export every (seconds)")).toBe(false);
  expect(await applyJourneyImprovement(fakePage().page,edit)).toEqual([{resourceId:"monitor",setting:"monitoringPolicy.collectionIntervalSeconds",value:"2"}]);
  await expect(applyJourneyImprovement(fakePage({controlMissing:true}).page,edit)).rejects.toThrow("requested control is missing");
  await expect(applyJourneyImprovement(fakePage({storedValue:"20"}).page,edit)).rejects.toThrow("did not retain");
});
