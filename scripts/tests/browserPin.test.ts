import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";

test("browser bundle identity remains pinned to the fully checked server engine", () => {
  const result = execFileSync(process.execPath, ["--no-env-file", "scripts/browser-first-stack/pin.ts"], { encoding: "utf8", timeout: 60000 });
  expect(result).toContain("Browser engine pin:");
}, 60000);
