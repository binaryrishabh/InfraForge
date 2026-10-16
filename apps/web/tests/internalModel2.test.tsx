import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { authoringGroups } from "@infraforge/contracts/internal-model2";
import type { Review } from "@infraforge/contracts/internal-model2";
import { blankDraft, educationalExample, readDraft, saveDraft } from "../src/features/internalModel2/draft";
import { AuthoringFields } from "../src/features/internalModel2/AuthoringFields";
import { ReviewPanel } from "../src/features/internalModel2/ReviewPanel";
test("blank authoring has no manufactured numbers and every quantity has a named unit", () => {
  const draft = blankDraft(); expect(Object.values(draft.values).every((v) => v === "")).toBe(true);
  const html = renderToStaticMarkup(<AuthoringFields draft={draft} change={() => {}} errors={[{ code: "AUTHORED_VALUE", path: "readCpu", message: "Enter authored CPU demand" }]} />);
  for (const f of authoringGroups.flatMap((g) => g.fields)) expect(html).toContain(`${f.label} (${f.unit})`);
  expect(html).toContain('aria-invalid="true"'); expect(html).toContain("Enter authored CPU demand");
  expect(html).toContain("Physical performance and full pricing remain Unknown");
});
test("review makes exact request, assumptions and consent explicit; uncertain retry keeps original identity", () => {
  const draft = educationalExample(), review: Review = { request: { infrastructureId: "design", expectedDesignUpdatedAt: "revision", idempotencyKey: "same-key", workload: {}, contract: {} }, requestHash: "hash", revision: "revision", designName: "<script>untrusted</script>", fields: [], assumptions: ["Physical timing Unknown"], arrivals: 20 };
  const html = renderToStaticMarkup(<ReviewPanel review={review} draft={draft} pending={false} busy={false} submit={() => {}} edit={() => {}} />);
  expect(html).not.toContain("<script>"); expect(html).toContain("&lt;script&gt;"); expect(html).toContain("same-key");
  expect(html).toContain("No execution has been admitted by validation"); expect(html).toContain("I reviewed this saved revision");
  const pending = renderToStaticMarkup(<ReviewPanel review={review} draft={draft} pending busy={false} submit={() => {}} edit={() => {}} />);
  expect(pending).toContain("Retry exact submission"); expect(pending).toContain("including after refresh");
});
test("tab drafts and uncertain requests are isolated by owner and tolerate unavailable or corrupt storage", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage"), entries = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value) } });
  try {
    const value = { design: "alice-design", draft: educationalExample(), review: null, pending: false, lastRun: "" };
    expect(saveDraft("alice", value)).toBe(true); expect(readDraft("alice")).toEqual(value); expect(readDraft("bob").design).toBe("");
    entries.set("infraforge-model2-authoring/1:alice", "broken"); expect(readDraft("alice").design).toBe("");
    entries.set("infraforge-model2-authoring/1:alice", JSON.stringify({ ...value, draft: { ...value.draft, commands: [null] } })); expect(readDraft("alice").design).toBe("");
    entries.set("infraforge-model2-authoring/1:alice", JSON.stringify({ ...value, review: { request: {} }, pending: true })); expect(readDraft("alice").pending).toBe(false);
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get: () => { throw Error("Denied"); } });
    expect(saveDraft("alice", value)).toBe(false); expect(readDraft("alice").review).toBeNull();
  } finally { if (original) Object.defineProperty(globalThis, "sessionStorage", original); else Reflect.deleteProperty(globalThis, "sessionStorage"); }
});
