import { expect, test } from "bun:test";
import { isolationSelfCheck } from "../firstStack/isolationSelfCheck";
import { inputDigest } from "../firstStack/isolationProtocol";
import { fileURLToPath } from "node:url";

function fixture() {
  const events: string[] = [], opened: number[] = [], closed: number[] = [];
  let clock = 0, reads = 0;
  const probe: NonNullable<Parameters<typeof isolationSelfCheck>[0]> = { write: () => { events.push("write"); throw Object.assign(Error("readonly"), { code: "EROFS" }); },
    open: () => {
      if (opened.length === 100) throw Object.assign(Error("fd limit"), { code: "EMFILE" });
      const fd = 10 + opened.length; opened.push(fd); return fd;
    }, close: (fd: number) => { closed.push(fd); },
    counters: () => { events.push("counters"); return ++reads === 1 ? "nr_throttled 1\nthrottled_usec 10" : "nr_throttled 2\nthrottled_usec 20"; },
    interfaces: () => { events.push("interfaces"); return ["lo"]; },
    now: () => { clock += 1000; return clock; }, work: () => { events.push("work"); } };
  return { probe, events, opened, closed };
}

test("the real self-check collector performs each finite probe and closes every descriptor", () => {
  const f = fixture(); isolationSelfCheck(f.probe);
  expect(f.events).toEqual(["write", "counters", "work", "work", "work", "counters", "interfaces"]);
  expect(f.opened).toHaveLength(100); expect(f.closed).toEqual(f.opened);
});

test("collector failures prevent success, including missing denials and missing counters", () => {
  for (const failure of ["writable", "wrong-write-error", "no-fd-limit", "wrong-fd-error", "network", "throttle", "missing-counters"]) {
    const f = fixture();
    if (failure === "writable") f.probe.write = () => {};
    if (failure === "wrong-write-error") f.probe.write = () => { throw Object.assign(Error("denied"), { code: "EACCES" }); };
    if (failure === "no-fd-limit") f.probe.open = () => { const fd = f.opened.length; f.opened.push(fd); return fd; };
    if (failure === "wrong-fd-error") { const open = f.probe.open; f.probe.open = () => { if (f.opened.length === 50) throw Error("unavailable"); return open(); }; }
    if (failure === "network") f.probe.interfaces = () => ["lo", "eth0"];
    if (failure === "throttle") f.probe.counters = () => "nr_throttled 1\nthrottled_usec 10";
    if (failure === "missing-counters") f.probe.counters = () => "";
    expect(() => isolationSelfCheck(f.probe)).toThrow("limit probe failed");
    expect(f.closed).toEqual(f.opened); expect(f.opened.length).toBeLessThanOrEqual(160);
  }
});

test("the actual child refuses a failed canary self-check before replay or done", async () => {
  for (const [mode, failing] of [["canary", true], ["canary", false], ["replay", true]] as const) {
    const input = JSON.stringify({ owner: "fixture" });
    const child = Bun.spawn([process.execPath, "--no-env-file", "--no-install",
      fileURLToPath(new URL("./isolationChildHarness.ts", import.meta.url)), failing ? "fail" : "pass"],
    { stdin: new Blob([JSON.stringify({ mode, source: "fixture", inputHash: inputDigest(input), expected: {} }) + "\n" + input + "\n"]), stdout: "pipe", stderr: "pipe" });
    const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    const kinds = output.trim().split("\n").map(line => JSON.parse(line).kind);
    if (mode === "canary" && failing) {
      expect(code).toBe(1); expect(error).toContain("injected self-check failure");
      expect(kinds).toEqual(["ready"]); expect(error).not.toContain("replay invoked");
    } else {
      expect(code).toBe(0); expect(kinds).toEqual(["ready", "replay", "done"]);
      expect(error).toContain("replay invoked");
    }
    expect(error.includes("self-check invoked")).toBe(mode === "canary");
  }
});
