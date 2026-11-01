import { expect, test } from "bun:test";
import { hash, keyspaceDesign, prepareKeyspace } from "./keyspace.fixture";

// LF-normalized SHA-256 captured on untouched bd47e1755f67eacc79d0a3ea1a08990ef347dd4b. Never regenerate.
const accepted = [
  ["legacy", "3f7a2dcb5eba11a3f82a0b89f749690f95778ed8c8c1a8e05d6c6d3011f79082", "812c02f242d397c3a014a859d72c756a29b5ab81f44bf0f6bded9b653145fa4e", "32a0ab4f9112db79346711eefe2f9c3202756b156769901fddf26be4c0801521", "80d6aa79fd3268c9f1e2e09d2522556f12875fd429b9a4066d072bbdeac867af"],
  ["uniform", "9c6bfe8825a2799a6bda4487f73621eb1642f13805bf26178a61cfaa6c073a18", "c7f60dd8558e319365445a36ae3d60848a2f53fd1652a4980d2d1263f44e3f9b", "52ddbb87b36f422bc920b86885bcb7aefb374ac857833205e1951724810704bd", "ed4e502918cbf83042a0620d0c8b0117dca35fd4743b124c308fc8677fe5c427"],
  ["hot-key", "24e382b60b0bc3aaa16942c6526a4afd5dcce3a5adbfb7c08a56d0b30a1ed09a", "3c140bf04d1bf30a2457e9dc55a4c3ae975cefd67a282d170135b042c7367f6f", "05890cfe5fdda0ac6d5f45b79bb124338676f8736d13876488c1a12f5749c94c", "52e30772d967b1efaa4ecef7f0c60494b6dfdd83620e08708233080cc0c445eb"],
  ["cache-policy", "854746ae63b989bd15075bd2ebfc1af263e7faa8497435729edda897af5e5440", "74fd91229a622ce336d711879a77b75c45aa6863e687824674f3087872b78b6f", "fd59b9bb187d6d769201504eef2d38667ff1de2d4e74496ab00c660f2b9635cf", "d1398c883e661f73dba356268603f4cf8f6a36c9bfeca94c6bbc1a735d84369b"],
] as const;

for (const [mode, ...pins] of accepted) test(`Data Depth 3 bytes remain frozen: ${mode}`, () => {
  const d = keyspaceDesign(mode === "legacy" ? undefined : 10);
  if (mode === "hot-key" || mode === "cache-policy") d.resources[2]!.dataKeyspace!.accessPattern = "hot-key";
  if (mode === "cache-policy") d.resources[1]!.cachePolicy = { version: 1, ttlSeconds: 1, singleFlight: true };
  const f = prepareKeyspace(d, "cache-capacity-accepted"); f.runtime.advanceTo(10000000);
  expect([hash(f.contract), hash(f.compiled), hash(f.assumptions), hash(f.runtime.evidence())]).toEqual(pins);
  const cache = f.compiled.input.resources.find(r => r.kind === "cache")!;
  expect(cache.kind === "cache" && cache.capacity).toMatchObject({ value: 2147483648, unit: "bytes" });
});
