// Philox4x32-10, with published Random123 known-answer tests. Not a security primitive.
function multiply(a: number, b: number): [number, number] {
  const a0 = a & 65535, a1 = a >>> 16, b0 = b & 65535, b1 = b >>> 16;
  const p0 = a0 * b0, p1 = a1 * b0 + a0 * b1 + (p0 >>> 16);
  return [(a1 * b1 + Math.floor(p1 / 65536)) >>> 0, Math.imul(a, b) >>> 0];
}
export function philox(counter: readonly number[], key: readonly number[]): number[] {
  if (counter.length !== 4 || key.length !== 2 || [...counter, ...key].some((n) => !Number.isInteger(n) || n < 0 || n > 0xffffffff)) throw new Error("Philox needs uint32 words");
  let [a, b, c, d] = counter as [number, number, number, number];
  let [k0, k1] = key as [number, number];
  for (let round = 0; round < 10; round++) {
    const [h0, l0] = multiply(0xD2511F53, a), [h1, l1] = multiply(0xCD9E8D57, c);
    [a, b, c, d] = [(h1 ^ b ^ k0) >>> 0, l1, (h0 ^ d ^ k1) >>> 0, l0];
    k0 = (k0 + 0x9E3779B9) >>> 0; k1 = (k1 + 0xBB67AE85) >>> 0;
  }
  return [a, b, c, d];
}
function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}
// Tuple serialization avoids separator ambiguity. Hash collisions remain possible;
// these streams establish replay stability, not proven statistical independence.
export function keyedUniform(seed: string, resource: string, event: string, purpose: string, draw = 0): number {
  if (!Number.isInteger(draw) || draw < 0 || draw > 0xffffffff) throw new Error("Invalid draw index");
  return philox([hash(JSON.stringify([event, purpose])), hash(event), hash(purpose), draw],
    [hash(JSON.stringify([seed, resource])), hash(resource)])[0]! / 4294967296;
}
