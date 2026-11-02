import { expect, test } from "bun:test";
import { quotaDesign, prepareQuota } from "./vmCpuQuota.fixture";
import { hash } from "./keyspace.fixture";

// LF-normalized SHA-256 captured on untouched cd2ea2e1ef69b694fe7f74a28930ee52d6fdb38c. Never regenerate.
const pins = [
["plain","613fdec0b3cb79cfb7396a59209e3cfdd08efe8cc863188dd90ac94b3630eb7d","b7a97b525c059f9f9fd291e0dafb224e090f4480859699b83c1c4c9f8fd1bbf4","7b0077a55629bca4d958dfa34f1f759d22d5153b2841e8c37789053fb91f8414","839099b060a19c60882aef9deb7034ccd1b13d400870701c3d627aa24a6c09ad"],
["lb","894deb5a011a3bd323cbfc63cc8220542ecc9a22c6103bf253249446ecf1892b","06306f796f04fca2c926dd8e9881a10685e8a5971c65c650cb4d8c023797c8bd","8a15169b3f6d8d52f98e1cfafad2a9ea3a394abda7e035f7feb3c6f290ef25f9","7402e1f846002d166ef511954382f50b2aab2972b8e30fdc2c7738106485034b"],
["data","ee44e31000042cb5c4d47ec0d71c4797c66ab2c1be8f4004936793464bccfb2e","1913588559c253270327458205cd0d1fc971a03aabb8292b52f96909183958a2","32a0ab4f9112db79346711eefe2f9c3202756b156769901fddf26be4c0801521","ff4f0ffb9d9e71234073e0eaf3ae58c98224c026ac79044f22c15d7cbb7829c7"],
["autoscaled","9c09fb967e02bbbbd5eeda19fa40df28a8cca3c4d9d628af9e1291bbd4f7c7f8","2b74752ec00f0340c61a50bcdf428ab66a4eb5c501f9fed95259ce810f845030","c11fe16969cff088dc0c22f7505a6a43c4285f3521d399f01e71232f8d32daf6","783b5a0cae7f2cb73037468fb15dd6c8444b255ce6c781606807830855295d7b"],
["flow","9b53243329ee0e925eefdb8a1ac9e2d7281e6c138a34a5636109fef4358dbeb1","e28e24b9dbdd292db63effa6fc1c016a117bc0aa234c86421bb83ea185996e31","5a73133d9941e3cca3001b0bcfaaa1c7dfc974ef6765e43794916e7de2de7b44","d8f8e24f88412a20e09de9c2febd8d3bd3aa606415d88d92cca198351c4c56c3"],
["execution","2e431116c842d75d4dcc6939b85dcd396bf951cbb3fb759e347635e7fcbd3b0a","e3c7a2e243352ff4fe08e55d75ed41fbbd394f4a1147b4a3d04608f5fa888a6a","e6a8496b472a34e065ff5ebd444320b79fe6e6f30ec82b02c1efb4c5f573cfa9","8b76bdc78cebd47557a39da5ea04c82f8fda974fab535962125b28f25e8f39f6"],
] as const;
for (const [mode, ...expected] of pins) test(`VM memory historical compatibility: ${mode}`, () => {
  const f = prepareQuota(quotaDesign(mode)); f.runtime.advanceTo(3000000);
  expect([hash(f.contract), hash(f.compiled), hash(f.assumptions), hash(f.runtime.evidence())]).toEqual(expected);
});
