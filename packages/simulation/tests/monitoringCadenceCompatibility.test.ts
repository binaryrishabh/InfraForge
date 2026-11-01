import { expect, test } from "bun:test";
import { monitoringSetup } from "./monitoringCadence.fixture";
import { hash } from "./asyncCanvas.fixture";

// LF-normalized SHA-256 captured on untouched cb8e46685f44e55b40fce1a0403232c7b6c84332. Never regenerate.
const pins = [
  ["vm", "fbc2a218222e4e0eb9e043e2ce24645ba424653ed3eb4859939c779df0b6fb33", "abe2266e4f1a7446c5300a661f4e7df545bd6b528cc0d9eb1d69106baacb3592", "1201c6616ad7b691e1bd44febf80cf0c515b5d32d9b460e341a16c9c3e26cf20", "10202a823b7f4f3c96461b5ae5998b2c2c1fc9c8101b2d023acb9facfd46aa21"],
  ["db", "acb52623bcbf9337d81c32d762a58d009720393bf2f17aee24b8fd0ed344158d", "5156cb4d126c66dd8dcaa28aec994a97b05508af36d2e8299d748cc661ba95d6", "1cbd05423555d2bbc275ad0fe16140a9aee0abbdea77b48f557a11e952d20459", "d16872fddcca4d29ec0bacd65c7e0282116810226d7aaf179ab11edd1746c400"],
  ["multiple", "0f8eadf4c992c93fb7183d98fb090c67706767ac2f3ddf2fc866c5c315a01e27", "d61e23773adba6a760eef2ec961aaf842659f830be4e1042efc10ed275b35e98", "24593df688649a2af97c42adfd758dadd723ff468d829eec5926fa2244a5d56b", "c4a5e0f3a924f60b3ef337b17d1f8b15a59c7e04b98f2d953ec561221337a24a"],
  ["cdn-dns", "63935f42a11ff240dd8cca2fbdff06f8e80503f5a5ffd8f5f63e01ad3c870dfc", "64c1afad6e147688dcaf1fd62f5d6ff7294bffc87e1e4ab42876ec9e67e79ead", "183eef54a20fbe84ae4b1abe634a280df89ab104c4ee60d110b1fdf8508c35cc", "1b2ba86de42f92a2f4c10ad6ff580a4beb84f5666b788d06fa698cf49befcd4b"],
  ["target-outage", "61445223c41481fdca30da70940a3b4194c8c6d98110dac6dc559e6372ed882e", "6c000df040b7b5a8e12c2035ee7427236f5d3dd4ccbc497310a579fb49fe0aa4", "1201c6616ad7b691e1bd44febf80cf0c515b5d32d9b460e341a16c9c3e26cf20", "e609bfae43fb9b1887acdddd43737d62205a7eb11edf4cffc4cad67a0bd82d05"],
  ["backend-outage", "ea4fa1a246c98d940732c286fa02aea8ec19842abb17fae8948f038fe19d4f2a", "1b34e736c1aa688f6f51fd8b3eccb28c142e90e7666700a2619b12f582472453", "1201c6616ad7b691e1bd44febf80cf0c515b5d32d9b460e341a16c9c3e26cf20", "82ba867607cc24916775a5169940748e3ad13c661461757b3ddf408fcf13297d"],
] as const;
for (const [mode, ...expected] of pins) test(`Monitoring cadence preserves base contract, artifact, assumptions and evidence: ${mode}`, () => {
  const f = monitoringSetup(mode); f.runtime.advanceTo(65000000);
  expect([hash(f.contract), hash(f.compiled), hash(f.assumptions), hash(f.runtime.evidence())]).toEqual(expected);
  expect(f.compiled.input.resources.find(r => r.kind === "monitor")).toMatchObject({ interval: { value: 10000000 }, exportInterval: { value: 10000000 }, freshFor: { value: 30000000 } });
});
