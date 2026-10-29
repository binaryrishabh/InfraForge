import { test, expect } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AsyncSection } from "../src/features/canvas/components/inspector/AsyncSection";
import { DEFAULT_ASYNC_QUEUE_SETTINGS } from "@infraforge/domain/resource";

test("queue inspector renders absent measurements as Unknown with locked settings", () => {
  const html = renderToStaticMarkup(<AsyncSection resource={{ id: "queue", type: "Message Queue", x: 0, y: 0, asyncQueue: DEFAULT_ASYNC_QUEUE_SETTINGS }} disabled />);
  expect(html.match(/<dd>Unknown<\/dd>/g)).toHaveLength(7);
  expect(html).toContain("Oldest ready message age (seconds)");
  expect(html).toContain("disabled");
  expect(html).toContain("duplicate results");
  expect(html).not.toContain("[object Object]");
});
