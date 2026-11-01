import { expect, test } from "bun:test";
import { vmDesign, prepareVm } from "./vmExecution.fixture";
import { hash } from "./keyspace.fixture";

// LF-normalized SHA-256 captured on untouched ac6ae961b6046d534a954f316ec918a5b55f3b83. Never regenerate.
const accepted = [
  ["plain", "613fdec0b3cb79cfb7396a59209e3cfdd08efe8cc863188dd90ac94b3630eb7d", "b7a97b525c059f9f9fd291e0dafb224e090f4480859699b83c1c4c9f8fd1bbf4", "7b0077a55629bca4d958dfa34f1f759d22d5153b2841e8c37789053fb91f8414", "839099b060a19c60882aef9deb7034ccd1b13d400870701c3d627aa24a6c09ad"],
  ["lb-db", "2c0f477a8c51c96a28b74b205f572511230559f3adc2fac4b08c3521b57e89b0", "7f96632b62215ea04be3fa4d1a6bdacc0c4df20dfa62555267cfaacc0be71ad7", "1e5a4716446e6be1abe85585f42383d2c64c9c5aff6249920c0b39d6862b8f84", "20c4aa8aca1286d148b08dafd1f4dea758f845ebfc0c3a8801c4d9154c7babf1"],
  ["autoscaled", "9c09fb967e02bbbbd5eeda19fa40df28a8cca3c4d9d628af9e1291bbd4f7c7f8", "2b74752ec00f0340c61a50bcdf428ab66a4eb5c501f9fed95259ce810f845030", "c11fe16969cff088dc0c22f7505a6a43c4285f3521d399f01e71232f8d32daf6", "783b5a0cae7f2cb73037468fb15dd6c8444b255ce6c781606807830855295d7b"],
  ["async", "ad8f6f8311db602310b080564061753b4ca852be981b9ce611dbb10d7e872589", "9dadf3a830ff550d2502291a981ba79d96e71333039ebb1baef22b532ba81980", "fde40806e9d0323e26c114c1bfa80166dd32ac18143f4be8be149f64c85aad03", "bb7a2bc9ce2d318e0edf627f103de658604001fa01eae8dea592d7a580baff78"],
  ["flow", "9b53243329ee0e925eefdb8a1ac9e2d7281e6c138a34a5636109fef4358dbeb1", "e28e24b9dbdd292db63effa6fc1c016a117bc0aa234c86421bb83ea185996e31", "5a73133d9941e3cca3001b0bcfaaa1c7dfc974ef6765e43794916e7de2de7b44", "d8f8e24f88412a20e09de9c2febd8d3bd3aa606415d88d92cca198351c4c56c3"],
 ] as const;

for (const [mode, ...pins] of accepted) test(`pre-VM controls contract, compiled input, assumptions and evidence stay frozen: ${mode}`, () => {
  const f = prepareVm(vmDesign(mode)); f.runtime.advanceTo(3000000);
  expect([hash(f.contract), hash(f.compiled), hash(f.assumptions), hash(f.runtime.evidence())]).toEqual(pins);
});
