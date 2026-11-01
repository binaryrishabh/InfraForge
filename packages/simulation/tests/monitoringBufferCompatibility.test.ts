import { expect, test } from "bun:test";
import { bufferSetup } from "./monitoringBuffer.fixture";
import { hash } from "./asyncCanvas.fixture";

// LF-normalized SHA-256 captured on untouched d1a05e53e62c82ad40e9851dd2d86b4c23bffa59. Never regenerate.
const pins = [
  ["backend-outage", undefined, "ea4fa1a246c98d940732c286fa02aea8ec19842abb17fae8948f038fe19d4f2a", "1b34e736c1aa688f6f51fd8b3eccb28c142e90e7666700a2619b12f582472453", "1201c6616ad7b691e1bd44febf80cf0c515b5d32d9b460e341a16c9c3e26cf20", "82ba867607cc24916775a5169940748e3ad13c661461757b3ddf408fcf13297d"],
  ["target-outage", undefined, "61445223c41481fdca30da70940a3b4194c8c6d98110dac6dc559e6372ed882e", "6c000df040b7b5a8e12c2035ee7427236f5d3dd4ccbc497310a579fb49fe0aa4", "1201c6616ad7b691e1bd44febf80cf0c515b5d32d9b460e341a16c9c3e26cf20", "e609bfae43fb9b1887acdddd43737d62205a7eb11edf4cffc4cad67a0bd82d05"],
  ["vm", { version: 1, collectionIntervalSeconds: 2, exportIntervalSeconds: 3 }, "d715129c39a226489ff8e360f8f2a106d748625f89d1624c941dce3e6a7cfdfc", "4e72d094851fb18deb5f4aa7864424d940ebcc7c1d309089bf8d2ed88e135278", "c50099353faeed46ede8f5212dcb39ba68278000319b83480755ade94663d69a", "f2c465db05c30f11ba0d409b57f2d76123ed0260c2a2d1b59dc9ce37dcdb960c"],
  ["multiple", undefined, "0f8eadf4c992c93fb7183d98fb090c67706767ac2f3ddf2fc866c5c315a01e27", "d61e23773adba6a760eef2ec961aaf842659f830be4e1042efc10ed275b35e98", "24593df688649a2af97c42adfd758dadd723ff468d829eec5926fa2244a5d56b", "c4a5e0f3a924f60b3ef337b17d1f8b15a59c7e04b98f2d953ec561221337a24a"],
  ["slow-export", undefined, "b05220a1e8dead8d3fdaba00ebfff99d4ad8e7ad329785b5700e43d134f18d08", "d0f0d331d4569fd3da4696e8fef6d273ae88019f9bca3623146edd32d9553f8f", "1201c6616ad7b691e1bd44febf80cf0c515b5d32d9b460e341a16c9c3e26cf20", "ba3dc7757a4645fbbfc52ab810f72bdac1bb56f9d13896f71e81745ea98b01bb"],
] as const;
for (const [mode, policy, ...expected] of pins) test(`Monitoring buffer preserves Depth 1 contract, artifact, assumptions and evidence: ${mode}`, () => {
  const f = bufferSetup(mode, policy); f.runtime.advanceTo(65000000);
  expect([hash(f.contract), hash(f.compiled), hash(f.assumptions), hash(f.runtime.evidence())]).toEqual(expected);
  expect(f.compiled.input.resources.find(r => r.kind === "monitor")).toMatchObject({ bufferSamples: { value: 1000 }, bufferBytes: { value: 1048576 }, sampleBytes: { value: 128 }, batchSamples: { value: 100 }, attempts: { value: 2 } });
});
