import { expect, test } from "bun:test";
import { objectSetup } from "./objectCapacity.fixture";
import { hash } from "./asyncCanvas.fixture";

// LF-normalized SHA-256 captured on untouched a065bdc37a937f9acac1dfb8893aa1774b51c37e. Never regenerate.
const pins = [
  ["upload", "ebb8d4e2ecc8fd8e2fe26dc90829ecceb36db3f6e6a278550a17718294ae2aad", "27a4557949bba8291cd2c560bfd1252dfacc6271a91e28de5f2f26cada6764eb", "fde40806e9d0323e26c114c1bfa80166dd32ac18143f4be8be149f64c85aad03", "ee6e38531218c85a84a75b5fa0390bae605d4b917a883369d7df100ba4c61787"],
  ["idempotent", "b1f3a932afcec838ab04fe7b10f600ea4543ca3a543ab9bcf81df90e98fa03b9", "1f88d1be30c8c532c876ce16ff1145e1723edae95a9510448120118b6659bfd9", "7502c7a9210206034f32248434818be0abea143bff0353002358f5147892628f", "a0ebe85773778cc457b0b8fc891cc470c26cca1e65e338b40a853b6d4469b020"],
  ["cdn", "fe8fbd3663f57af3a1f84050f093c570b98d95a96a597f9fe7c1324e91b7af9a", "89b1c4dcf03e8f755be638c9f9650cd6778254f2cccc80fb57371aeea47720a3", "602a492a3379d76595bc1e52bdfcd8c377a96a67646ecc61190bb894cf7479bf", "0aca703895996e104115385d36001c4300d76e8d0404cd07adcb239a9e967ddd"],
  ["registry", "2e940fc43c28902218e7e552c67999d54ca78b77a358809e77efcc882f7f441b", "60d7e8a91743048d4bf126b19b38aca87064073fb08c9ca9ec27404251e2b462", "d4cfa1dccc37e33f35475e0c3b0a04880cb93b4f7f44d4d22df9f3ab436809a4", "33f46ef088702d23288f2f46a1ed698e5c94add76f4fbf74e3026429c91a6c7c"],
  ["plain", "13001f90de97de919132f064b5d96695d799ccfd5b83628ca3d12d7bd9371f56", "2d06afcad05be09ff962144c82c1a78906597d398357c1f3919cf129cddccab5", "58859449d99413ebd9969c6716bf9afef94a0a64a3c438f3bb76d033e873086a", "e3419f1e4a0ebb175842b23b45bdc22248cc210b4a5036cc8d92e7dc3187f4b5"],
] as const;
for (const [mode, ...expected] of pins) test(`Object capacity preserves historical contract, artifact, assumptions and evidence: ${mode}`, () => {
  const f = objectSetup(mode); f.runtime.advanceTo(f.runtime.horizon);
  expect([hash(f.contract), hash(f.compiled), hash(f.assumptions), hash(f.runtime.evidence())]).toEqual(expected);
  expect(f.compiled.input.resources.find(r => r.id === "store")).toMatchObject({ capacity: { value: 2147483648 } });
});
