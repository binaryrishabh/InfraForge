import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describeBrowserRunCard } from "../src/features/dashboard/browserRunCard";
import { NextStep } from "../src/features/dashboard/pages/HomePage";
import type { LiveDeploymentSummary } from "../src/api/deployment.api";
import { useBrowserRunStatus } from "../src/features/model2Run/browserRunStatus";

afterEach(() => useBrowserRunStatus.setState({ runs: {}, deadlines: {} }));

const run = (status: string): LiveDeploymentSummary => ({ id: "r1", infrastructureId: "d", infrastructureName: "Checkout", resourceCount: 6, challengeId: null, status,
  createdAt: new Date(Date.now() - 60_000).toISOString(), updatedAt: new Date().toISOString() }) as LiveDeploymentSummary;
const home = (status: string) => renderToStaticMarkup(<MemoryRouter><NextStep next={{ kind: "live", run: run(status) }} /></MemoryRouter>);

test("a browser run nothing holds is described as not running, and can be started again or discarded", () => {
  const card = describeBrowserRunCard("nothing", "Checkout", "1 min ago");
  expect(card).toMatchObject({ eyebrow: "Not running", canDiscard: true, open: "Start it again" });
  expect(card.body).toContain("nothing is running and nothing was saved");
  expect(card.body).not.toContain("keeps running on the server");
});

test("a finished run this tab still holds is never described as saved and is opened to send again", () => {
  const card = describeBrowserRunCard("unsent", "Checkout", "1 min ago");
  expect(card).toMatchObject({ title: "Your finished run has not been saved", canDiscard: false, open: "Open it and send again" });
  expect(card.body).toContain("exists only in this tab");
  for (const held of ["sending", "accepted"] as const) expect(describeBrowserRunCard(held, "x", "now").body).toContain("not saved until the server accepts it");
  expect(describeBrowserRunCard("worker", "x", "now").body).toContain("closing the tab ends it without a saved result");
});

test("Home shows the truthful card for a browser run and keeps the old card for a server run", () => {
  const stale = home("browser");
  expect(stale).toContain("is waiting for a browser"); expect(stale).toContain("Discard this run"); expect(stale).toContain("Start it again");
  expect(stale).not.toContain("keeps running on the server");
  // Server rendering reads zustand's initial state, so the held run is placed there for this render.
  const initial = useBrowserRunStatus.getInitialState(), before = initial.runs;
  initial.runs = { r1: { kind: "unsent", reason: "The server could not be reached." } };
  let unsent: string;
  try { unsent = home("browser"); } finally { initial.runs = before; }
  expect(unsent).toContain("Your finished run has not been saved"); expect(unsent).not.toContain("Discard this run");
  const server = home("live");
  expect(server).toContain("It keeps running on the server until it is stopped"); expect(server).toContain("Return to the run"); expect(server).not.toContain("Discard this run");
});
