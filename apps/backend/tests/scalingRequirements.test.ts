import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { retryingAFullPoolV1 as retry } from "../challenges/definitions/retrying-a-full-pool/v1";
import { preflight } from "../challenges/preflight";

test("backend admission budget renders through the existing generic requirement list", async () => {
  const checks = preflight(retry, retry.starter!).checks;
  expect(checks.find(c => c.id === "amplification")!.status).toBe("during-run");
  // Run with the web workspace's JSX and alias settings, without importing web
  // runtime code into the backend build or adding a second requirement renderer.
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", `
    import { createElement } from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { RequirementList } from "./src/features/challenges/components/RequirementList";
    const props = await Bun.stdin.json();
    console.log(renderToStaticMarkup(createElement(RequirementList, props)));
  `], {cwd: resolve(import.meta.dir, "../../web"), stdin: "pipe", stdout: "pipe", stderr: "pipe"});
  child.stdin.write(JSON.stringify({criteria: retry.criteria, checks}));
  child.stdin.end();
  const [html, errors] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (await child.exited !== 0) throw Error(errors);
  expect(html).toContain("<ol");
  expect(html.match(/<li /g)).toHaveLength(retry.criteria.length);
  expect(html).toContain(retry.criteria.find(c => c.id === "amplification")!.label);
  expect(html).toContain("Measured at simulated second 6.");
});
