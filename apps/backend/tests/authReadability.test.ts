import { expect, test } from "bun:test";

test("reviewed admission, retry and token code stays within 120 columns", async () => {
  const modules = ["credentials", "turnstile", "emailTemplate", "mailIntent", "mailRequests",
    "mailAdmission", "createAuth", "accountPolicy", "loginMethods", "methodSettings"];
  const violations: string[] = [];
  for (const name of modules) {
    const source = await Bun.file(new URL(`../auth/${name}.ts`, import.meta.url)).text();
    source.split(/\r?\n/).forEach((line, index) => {
      if (line.length > 120) violations.push(`${name}:${index + 1} (${line.length} columns)`);
    });
  }
  expect(violations).toEqual([]);
});
