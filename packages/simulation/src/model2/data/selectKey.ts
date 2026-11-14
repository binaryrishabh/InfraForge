import { keyedUniform } from "../random";

/** The first saved key stays hot. Separate purposes keep the share and cold-key decisions independent. */
export function selectDataKey(keys: readonly string[], access: "keyed-uniform" | "keyed-hot", seed: string, resource: string, root: string): string {
  if (access === "keyed-uniform") return keys[Math.floor(keyedUniform(seed, resource, root, "data-key") * keys.length)]!;
  if (keys.length === 1 || Math.floor(keyedUniform(seed, resource, root, "hot-key-share/1") * 100) < 80) return keys[0]!;
  return keys[1 + Math.floor(keyedUniform(seed, resource, root, "hot-key-cold/1") * (keys.length - 1))]!;
}

/** The two rows of a two-row write: the requested row, then another row drawn uniformly. "by-key" takes them in the keyspace's fixed order instead. */
export function orderedRowPair(keys: readonly string[], key: string, order: "as-requested" | "by-key", seed: string, resource: string, root: string): { first: string; second: string } {
  if (keys.length < 2) throw Error("A two-row write needs at least two keys");
  const at = keys.indexOf(key), pick = Math.floor(keyedUniform(seed, resource, root, "second-key/1") * (keys.length - (at < 0 ? 0 : 1))), second = keys[at >= 0 && pick >= at ? pick + 1 : pick]!;
  return order === "by-key" && keys.indexOf(second) < at ? { first: second, second: key } : { first: key, second };
}
