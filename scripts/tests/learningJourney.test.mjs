import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { JOURNEY_LABS, changeJourneyControl, isLocalJourneyRequest, journeyLab } from "../qa/learning-journey.mjs";

test("the lab table has unique lesson ids, explicit controls and recorded-verdict expectations", () => {
  expect(JOURNEY_LABS.map((lab) => lab.lessonId)).toEqual([
    "where-does-the-time-go", "writes-cost-more-than-reads", "balancer-shares-turns",
  ]);
  expect(new Set(JOURNEY_LABS.map((lab) => lab.lessonId)).size).toBe(JOURNEY_LABS.length);
  for (const lab of JOURNEY_LABS) {
    expect(lab.lessonId).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
    expect(lab.title).toBeInstanceOf(RegExp);
    expect(lab.prediction.trim().length).toBeGreaterThan(0);
    expect(lab.hypothesis.trim().length).toBeGreaterThan(0);
    expect(lab.improvement.stepName.trim().length).toBeGreaterThan(0);
    expect(lab.improvement.nodeSelector.trim().length).toBeGreaterThan(0);
    expect(lab.improvement.nodeText).toBeInstanceOf(RegExp);
    expect(lab.improvement.fallbackText).toBe(lab.improvement.resourceId);
    expect(lab.improvement.role).toBe("radio");
    expect(lab.improvement.name.test(lab.improvement.to)).toBe(true);
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
function fakePage({ nodeMissing = false, controlMissing = false } = {}) {
  const calls = [];
  const size = {
    first() { return this; },
    async waitFor() { if (controlMissing) throw new Error("requested control is missing"); },
    async check() { calls.push("checked"); },
  };
  const page = {
    locator(selector) {
      calls.push(selector);
      return {
        filter() { return this; }, first() { return this; },
        async click() { if (nodeMissing) throw new Error("node not found"); },
      };
    },
    getByText(text, options) {
      calls.push([text, options]);
      return { first() { return this; }, async click() {} };
    },
    getByRole(role, options) { calls.push([role, options.name.source]); return size; },
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
