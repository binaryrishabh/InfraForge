import { digest, lf } from "./hash";

type Scalar = string | number | boolean | null;
type Value = Scalar | ["ref", string];
export type MerkleNode = ["object", Array<[string, Value]>] | ["array", Value[]] | ["chunk", string] | ["text", string[]];
export type NodePack = Array<[string, MerkleNode]>;
export const nodeHash = (node: MerkleNode) => digest(["execution-merkle-node/1", node]);
const hashPattern = /^[a-f0-9]{64}$/;
const scalar = (value: unknown): value is Scalar => value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value);

// Containers share subtrees; source text shares content-defined chunks, including
// repeated generated JSON. Chunk boundaries resynchronize after local edits.
export class MerkleBuilder {
  readonly nodes = new Map<string, MerkleNode>();
  add(node: MerkleNode) {
    const hash = nodeHash(node);
    this.nodes.set(hash, node);
    return hash;
  }
  value(value: unknown): Value {
    if (scalar(value)) return value;
    if (Array.isArray(value)) return ["ref", this.add(["array", value.map(item => this.value(item))])];
    if (value && typeof value === "object") return ["ref", this.add(["object", Object.keys(value).sort().map(key => [key, this.value((value as Record<string, unknown>)[key])])])];
    throw Error("Non-JSON Merkle value");
  }
  object(value: object) { return (this.value(value) as ["ref", string])[1]; }
  text(source: string) {
    const text = lf(source), chunks: string[] = [];
    let start = 0, rolling = 0;
    for (let i = 0; i < text.length; i++) {
      rolling = ((rolling << 1) + text.charCodeAt(i)) >>> 0;
      const length = i + 1 - start;
      if (length >= 1024 && ((rolling & 4095) === 0 || length >= 16384)) {
        chunks.push(this.add(["chunk", text.slice(start, i + 1)])); start = i + 1;
      }
    }
    if (start < text.length) chunks.push(this.add(["chunk", text.slice(start)]));
    return this.add(["text", chunks]);
  }
  pack(): NodePack { return [...this.nodes].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0); }
}

export function readMerklePack(input: unknown, roots: string[]) {
  if (!Array.isArray(input)) throw Error("Invalid Merkle pack");
  const nodes = new Map<string, MerkleNode>(), references = new Map<string, string[]>();
  let previous = "";
  for (const row of input) {
    if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== "string" || !hashPattern.test(row[0]) || row[0] <= previous) throw Error("Duplicate or unordered Merkle index");
    const [hash, node] = row;
    previous = hash;
    if (!Array.isArray(node) || node.length !== 2) throw Error("Invalid Merkle node");
    const refs: string[] = [];
    const reference = (ref: unknown) => { if (typeof ref !== "string" || !hashPattern.test(ref)) throw Error("Invalid Merkle reference"); refs.push(ref); };
    const value = (item: unknown) => {
      if (scalar(item)) return;
      if (!Array.isArray(item) || item.length !== 2 || item[0] !== "ref") throw Error("Unknown Merkle value tag");
      reference(item[1]);
    };
    if (node[0] === "object") {
      if (!Array.isArray(node[1])) throw Error("Invalid Merkle object");
      let key: string | undefined;
      for (const entry of node[1]) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || key !== undefined && entry[0] <= key) throw Error("Duplicate or unordered Merkle object key");
        key = entry[0]; value(entry[1]);
      }
    } else if (node[0] === "array") {
      if (!Array.isArray(node[1])) throw Error("Invalid Merkle array");
      node[1].forEach(value);
    } else if (node[0] === "text") {
      if (!Array.isArray(node[1])) throw Error("Invalid Merkle text");
      node[1].forEach(reference);
    } else if (node[0] === "chunk") {
      if (typeof node[1] !== "string" || node[1] !== lf(node[1])) throw Error("Non-LF Merkle text");
    } else throw Error("Unknown Merkle node tag");
    nodes.set(hash, node as MerkleNode); references.set(hash, refs);
  }
  const visited = new Set<string>(), active = new Set<string>();
  function visit(hash: string, depth: number) {
    if (active.has(hash)) throw Error("Cyclic Merkle references");
    if (visited.has(hash)) return;
    if (!nodes.has(hash)) throw Error("Dangling Merkle reference");
    if (depth > 512) throw Error("Merkle depth limit");
    active.add(hash);
    for (const ref of references.get(hash)!) visit(ref, depth + 1);
    active.delete(hash); visited.add(hash);
  }
  roots.forEach(root => visit(root, 0));
  if (visited.size !== nodes.size) throw Error("Unknown unreachable Merkle nodes");
  for (const [hash, node] of nodes) {
    if (nodeHash(node) !== hash) throw Error("Wrong Merkle node hash");
    if (node[0] === "text" && node[1].some(ref => nodes.get(ref)?.[0] !== "chunk")) throw Error("Invalid Merkle text reference");
  }
  const cache = new Map<string, unknown>();
  const value = (item: Value): unknown => Array.isArray(item) ? expand(item[1]) : item;
  function expand(hash: string): unknown {
    if (cache.has(hash)) return cache.get(hash);
    const node = nodes.get(hash);
    if (!node) throw Error("Missing Merkle root");
    const result = node[0] === "object" ? Object.fromEntries(node[1].map(([key, item]) => [key, value(item)])) :
      node[0] === "array" ? node[1].map(value) : node[0] === "text" ? node[1].map(ref => expand(ref)).join("") : node[1];
    if (node[0] === "text" && typeof result === "string" && result !== lf(result)) throw Error("Non-LF reconstructed text");
    cache.set(hash, result); return result;
  }
  return { expand, index: digest([...nodes.keys()]), nodes };
}
