import { expect, test } from "bun:test";
import { loadTransitions } from "../../apps/backend/executionIdentity/transitions";
import { sourceHash, digest } from "../../apps/backend/executionIdentity/hash";
import { historicalIsolationDescriptor } from "../historical-isolation-descriptor";

test("the submission baseline retains old Prisma bytes and reconstructs with the existing isolation reader", () => {
  const store = loadTransitions(process.cwd()), history = store.history();
  const row = store.table.entries.find(row => row.commit === "7fdc72ef9c77bb0ad44bda3134f1899e31e6e9f1")!;
  expect(row.algorithm).toBe("isolation-boundary/1");
  const files = history.trees[row.commit]!;
  const tree = { paths: Object.keys(files), read: (path: string) => {
    const text = history.blobs[files[path]!]; if (text === undefined) throw Error(`Missing retained source: ${path}`); return text;
  } };
  expect(digest(historicalIsolationDescriptor(tree, store.table.descriptors[row.descriptor]!.runtime))).toBe(row.descriptor);
  const generated = tree.paths.filter(path => path.includes("/generated/") && path.endsWith(".ts"));
  expect(generated.length).toBeGreaterThan(0);
  for (const path of generated) expect(sourceHash(tree.read(path))).toBe(files[path]!);
  const client = "apps/backend/lib/generated/prisma/client.ts";
  expect(() => historicalIsolationDescriptor({ ...tree, read: path => tree.read(path) + (path === client ? "\n" : "") }, store.table.descriptors[row.descriptor]!.runtime)).toThrow("Unreviewed dynamic execution loader: apps/backend/lib/generated/prisma/client.ts");
}, 120000);
