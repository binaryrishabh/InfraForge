import { keyedUniform } from "../random";

/** The first saved key stays hot. Separate purposes keep the share and cold-key decisions independent. */
export function selectDataKey(keys: readonly string[], access: "keyed-uniform" | "keyed-hot", seed: string, resource: string, root: string): string {
  if (access === "keyed-uniform") return keys[Math.floor(keyedUniform(seed, resource, root, "data-key") * keys.length)]!;
  if (keys.length === 1 || Math.floor(keyedUniform(seed, resource, root, "hot-key-share/1") * 100) < 80) return keys[0]!;
  return keys[1 + Math.floor(keyedUniform(seed, resource, root, "hot-key-cold/1") * (keys.length - 1))]!;
}
