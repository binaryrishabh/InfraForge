import { expect, test } from "bun:test";
import { dnsSetup } from "./dnsDepth.fixture";
import { hash } from "./asyncCanvas.fixture";

// LF-normalized SHA-256 captured before production edits on c477f0efa708e92af666e5995f157b875a79a5b6. Never regenerate.
const pins = [
  ["vm", "a0fda1595bf5a954a3de56a7d40e2638c546e16e91d7e13f2b6fe217adab8a31", "b983065e6e6a9ab588653f0cbab1c9a3d061beee44594b68673f5400a4b11d3a", "b3185c6439b7b371a5ddf25be7701e46a666f47522294ee73895feba81296a80", "251412dfa8a57048521bd2bd464369a1d3aa8468eb45faa83eb7978c7afda02e"],
  ["cdn", "b234d6ef4f860427a3eb2b6171609958001d6ed56152bc63dc9184744f815298", "9d44b0a0e7a4902d62429b11b6a02b9ccf814e7fec5c5ce54f51c2010f9131a2", "32a9aa74ed6530edd95b9423a07a9c80125145329cb57749fe3b025923ec1edb", "f83442bcd1f6890c0284ce37592b83adca542e7d5dfc8b305b352c1d073331bc"],
] as const;
for (const [mode, ...expected] of pins) test(`regression: DNS historical contract, input, assumptions and evidence: ${mode}`, () => {
  const f = dnsSetup(undefined, mode); f.runtime.advanceTo(12000000);
  expect([hash(f.contract), hash(f.compiled), hash(f.assumptions), hash(f.runtime.evidence())]).toEqual(expected);
});
