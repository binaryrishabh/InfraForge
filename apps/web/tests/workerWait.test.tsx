import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_ASYNC_WORKER_SETTINGS, asyncSettingsError, type Resource } from "@infraforge/domain/resource";
import { AsyncSection } from "../src/features/canvas/components/inspector/AsyncSection";

const worker = (externalWaitMs?: number): Resource => ({ id: "worker", type: "Virtual Machine", x: 0, y: 0, asyncWorker: { ...DEFAULT_ASYNC_WORKER_SETTINGS, ...(externalWaitMs === undefined ? {} : { externalWaitMs }) } });
test("worker exposes one bounded external wait input, blank by default, with the saved value shown", () => {
  const html = renderToStaticMarkup(<AsyncSection resource={worker()} disabled={false} />);
  expect(html.split("Wait on an external dependency per job")).toHaveLength(2);
  expect(html).toContain("Default (0 ms)");
  expect(renderToStaticMarkup(<AsyncSection resource={worker(450)} disabled />)).toContain('value="450"');
  expect(asyncSettingsError("Virtual Machine", undefined, worker(450).asyncWorker)).toBeUndefined();
  expect(asyncSettingsError("Virtual Machine", undefined, worker(60001).asyncWorker)).toBeDefined();
});
