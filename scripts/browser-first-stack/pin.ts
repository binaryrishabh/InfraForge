import { execFileSync } from "node:child_process";
// Use the existing reviewed identity command, including its full checks. This
// offline generator is not an execution host and gains no launch capability.
const checked = JSON.parse(execFileSync(process.execPath, ["--no-env-file", "scripts/execution-identity.ts", "--check"], { encoding: "utf8" }));
const value = { schema: "first-stack-browser-pin/1", source: checked.current as string };
const file = "apps/web/src/firstStack/enginePin.json", text = JSON.stringify(value, null, 2) + "\n";
if (process.argv.includes("--write")) await Bun.write(file, text);
else if ((await Bun.file(file).text()).replaceAll("\r\n", "\n") !== text) throw Error("Browser engine pin drift; review and regenerate with --write");
console.log(`Browser engine pin: ${value.source}`);
