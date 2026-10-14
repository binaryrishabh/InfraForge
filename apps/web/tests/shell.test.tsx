import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "../src/components/shell/AppShell";
import { NotFoundPage } from "../src/features/dashboard/pages/NotFoundPage";
import { nextStep, type HomeData } from "../src/features/dashboard/nextStep";
import { StatusMark } from "../src/ui/StatusMark";
import { HealthMark } from "../src/ui/HealthMark";
import { summary } from "./fixtures";

test("the shell offers four destinations, marks the current one and starts with a skip link", () => {
  const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/runs"]}><Routes><Route element={<AppShell />}><Route path="/runs" element={<p>runs page</p>} /></Route></Routes></MemoryRouter>);
  expect(html.indexOf("Skip to content")).toBeLessThan(html.indexOf("Home"));
  for (const href of ["/home", "/challenges", "/designs", "/runs"]) expect(html).toContain(`href="${href}"`);
  expect(html).toContain('aria-current="page"');
  expect(html).toContain('id="main"');
  expect(html).toContain("runs page");
  expect(html).not.toContain("soon");
});

test("not found offers a way back", () => {
  const html = renderToStaticMarkup(<MemoryRouter><NotFoundPage /></MemoryRouter>);
  expect(html).toContain("404"); expect(html).toContain('href="/"');
});

test("status and health always pair a word with a shape", () => {
  for (const html of [renderToStaticMarkup(<StatusMark kind="not-met" />), renderToStaticMarkup(<HealthMark value="degraded" />)]) {
    expect(html).toContain("<svg"); expect(html).toContain('aria-hidden="true"');
  }
  expect(renderToStaticMarkup(<StatusMark kind="not-met" />)).toContain("Not met");
  expect(renderToStaticMarkup(<HealthMark value="degraded" />)).toContain("Degraded");
  expect(renderToStaticMarkup(<HealthMark value={undefined} />)).toContain("Unknown");
});

test("home recommends one next step in a fixed priority order", () => {
  const base: HomeData = { live: [], challenges: [summary, { ...summary, id: "b" }], runs: [], designs: [] };
  expect(nextStep(base)).toMatchObject({ kind: "start", challenge: { id: summary.id } });
  expect(nextStep({ ...base, challenges: [{ ...summary, workspaceDesignId: "d" }] })).toMatchObject({ kind: "continue" });
  const failed = { ...summary, attempts: 1, latest: { runId: "r", createdAt: "", status: "not-met" as const, metCount: 1, total: 3 } };
  expect(nextStep({ ...base, challenges: [summary, failed] })).toMatchObject({ kind: "improve" });
  const live = { id: "l", infrastructureId: "d", infrastructureName: "Live", resourceCount: 2, status: "live", createdAt: "", updatedAt: "", challengeId: null };
  expect(nextStep({ ...base, live: [live] })).toMatchObject({ kind: "live" });
  expect(nextStep({ ...base, challenges: [{ ...summary, met: true, attempts: 1 }] })).toEqual({ kind: "free" });
});
