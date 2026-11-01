import { expect, test } from "bun:test";
import { hash, keyspaceDesign, prepareKeyspace } from "./keyspace.fixture";

// LF-normalized SHA-256 captured on untouched 3bb61d0186770a3f1bb86483851003abad9d4946. Never regenerate.
const accepted = [
  ["legacy", "5aaa03a9a57b633882d8c773b04a6545b196f85a7f34e02858595c3a4179efbb", "526b7147defae46f6657ebad451d82c52c4039404707e3a824730ae453086b5c", "32a0ab4f9112db79346711eefe2f9c3202756b156769901fddf26be4c0801521", "1cf1bcd3a0e3e7cfbddb19e16db84c8f98373a815b6535a2f35d86e97b6e3ce2"],
  ["uniform", "e79d1a71b9d28717ca3f557b9ad67cbd905a884d7593a737c0a8d6923db77bcd", "cd9217d1a7161c8f28dc71019c21b672c1df0e6f02784fc75b4957954fd17f5d", "52ddbb87b36f422bc920b86885bcb7aefb374ac857833205e1951724810704bd", "d25dd15998411bd249b16448c045f56f9bdc7f2da314cb16f282be78007d8b35"],
  ["hot-key", "415911068823bc030daf8d28734ff976d864e391c94a2138984abeca720a72e0", "35611aba3aa9449452f0e5a39ca57b23e142864b88d21f1ff0a1b29f2fcdd71d", "05890cfe5fdda0ac6d5f45b79bb124338676f8736d13876488c1a12f5749c94c", "50807be5ddfb8782a28723d297c9f724e521c6284b7bdf79414aab5a4c80aa90"],
  ["cache-policy", "d9f8cc0e49f3990e5f5b61021ab6c020d6c12291a0c84aa51ddd1bda4a62c615", "24a2900789fa16fc5c439124b8f06dbff0a335e966dab1d97d7e0c541adbf51c", "fd59b9bb187d6d769201504eef2d38667ff1de2d4e74496ab00c660f2b9635cf", "93a8dad9353e9b2b54b8ec8632ecb9da7592ce65fdc472d0fdf608f70018dbd2"],
  ["cache-capacity", "c042976aa0dc67b93caaf566f077b1426797cca52f5127a912205fd51264a116", "5cb4ca721d7fc814387034880247cc40c9757f528d25fdf8ac74643794b1c04f", "dbb5ebc30cff8b5f4cbc15e4ab1ed4a9f4fcc6b8e7b64754edb022778f5522fa", "7b798fb7fb95097006731e167220e072a94dccdf78a1d4a0f90abd6d8db21e2b"],
] as const;

for (const [mode, ...pins] of accepted) test(`Data Depth 4 bytes and fixed query budgets remain frozen: ${mode}`, () => {
  const d = keyspaceDesign(mode === "legacy" ? undefined : 10);
  if (["hot-key", "cache-policy", "cache-capacity"].includes(mode)) d.resources[2]!.dataKeyspace!.accessPattern = "hot-key";
  if (mode === "cache-policy") d.resources[1]!.cachePolicy = { version: 1, ttlSeconds: 1, singleFlight: true };
  if (mode === "cache-capacity") d.resources[1]!.cachePolicy = { version: 2, capacityEntries: 3, ttlSeconds: 1, singleFlight: true };
  const f = prepareKeyspace(d, "db-contention-accepted"); f.runtime.advanceTo(10000000);
  expect([hash(f.contract), hash(f.compiled), hash(f.assumptions), hash(f.runtime.evidence())]).toEqual(pins);
  expect(f.compiled.input.resources.find(r => r.kind === "relational")).toMatchObject({ semantics: "postgresql-keyed/2", activeTransactions: { value: 16 }, pendingQueries: { value: 256 }, maxSessions: { value: 100 } });
});
