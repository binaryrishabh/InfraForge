import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { starter } from "../challenges/starter";
import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";

// Digests captured at base 46f8a9f, before any capability added after it. An unmarked design must still compile and run to exactly these values; never regenerate.
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
const wl = (rpm: number, rw = 0.8) => ({ targetThroughput: rpm, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, peakMultiplier: 1, readWriteRatio: rw, payloadSize: "light" as const });
const cases: Record<string, [ReturnType<typeof starter>, ReturnType<typeof wl>, [string, string, string, string[]]]> = {
  cacheDefault: [starter([["app", "Virtual Machine", 0, 0], ["cache", "Cache", 1, 0], ["db", "Database", 1, 1]], [["app", "cache"], ["app", "db"]]), wl(3000, 1), ["f7f01b3b8e1b870d", "b58ee4643be176b1", "9cf920ef4f2d60b8", ["f4dbaf410dc7f0f0", "174db7f592f81c38", "a1edbb4307eb44ea"]]],
  dnsDefault: [starter([["dns", "DNS", 0, 0], ["lb", "Load Balancer", 1, 0], ["app", "Virtual Machine", 2, 0], ["app2", "Virtual Machine", 2, 1]], [["dns", "lb"], ["lb", "app"], ["lb", "app2"]]), wl(1200), ["2629655a1dee3778", "8ab2547ef55f4753", "fb1e59497be728e2", ["8c0e7801542036a6", "71f4362112ab3f98", "03393602ed6754d0"]]],
  queueDefault: [starter([["app", "Virtual Machine", 0, 0], ["queue", "Message Queue", 1, 0, { asyncQueue: { enabled: true, visibilityTimeoutSeconds: 30, maxReceives: 3, retentionSeconds: 300 } }], ["worker", "Virtual Machine", 2, 0, { asyncWorker: { enabled: true, concurrency: 1, prefetch: 1, cpuMsPerJob: 250 } }], ["store", "Object Storage", 1, 2]], [["app", "queue"], ["app", "store"], ["queue", "worker"], ["worker", "store"]]), wl(600, 1), ["7e32ada690d07d37", "c9c29024d9e1b7c0", "4431412995f655a8", ["8338d257b9ce21ff", "9a897d7ba7ae8b4d", "71d32bd2dd084256"]]],
  gateway: [starter([["gw", "API Gateway", 0, 0], ["app", "Virtual Machine", 1, 0], ["db", "Database", 2, 0]], [["gw", "app"], ["app", "db"]]), wl(1200), ["20ee7854a33a504a", "f3acde90cbe0b6da", "a281dcf626faa932", ["ff285d92fb5b7b4e", "bc4ffdbd7288b866", "908cd124b4c5ba33"]]],
  autoscaling: [starter([["lb", "Load Balancer", 0, 0, { autoscaling: { enabled: true, minReplicas: 1, maxReplicas: 3, targetCpu: 20 } }], ["app", "Virtual Machine", 1, 0], ["db", "Database", 2, 0]], [["lb", "app"], ["app", "db"]]), wl(6000), ["90a22aa31d692513", "9f792c5040edcc35", "d4168c5f41b9846c", ["da6c37849f93401d", "9ecfc80a3233f749", "be99a94043c0614c"]]],
};
for (const [name, [design, workload, pins]] of Object.entries(cases)) test(`unmarked ${name} design keeps its base inputs, compiled contract, live views and evidence`, () => {
  const input = captureRunInputs({ ...design, layoutVersion: 3 }, workload, `synth:${name}`);
  expect(input.adapterProfiles ?? []).not.toContain("autoscaling-observed/1");
  const engine = createModel2Engine(input, 30), views: string[] = [];
  for (let s = 1; s <= 30; s++) { engine.advance(); if (s % 10 === 0) views.push(sha(engine.view())); }
  expect([sha(input), sha(buildContractFromRunInputs(input, 30)), sha(engine.evidence()), views]).toEqual([pins[0], pins[1], pins[2], pins[3]]);
});
