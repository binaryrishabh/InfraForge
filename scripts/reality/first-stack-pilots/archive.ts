import { createReadStream, createWriteStream, existsSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createGzip, createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";

async function hash(path: string, decompress = false) {
  const stream = createReadStream(path), input = decompress ? stream.pipe(createGunzip()) : stream, h = createHash("sha256");
  let bytes = 0; for await (const chunk of input) { h.update(chunk); bytes += chunk.length; } return { bytes, sha256: h.digest("hex") };
}
const dir = resolve(process.argv[2] ?? "");
if (!process.argv[2] || !JSON.parse(readFileSync(resolve(dir, "campaign.json"), "utf8")).endedAt || existsSync(resolve(dir, "archive.json"))) throw Error("Provide a completed, not-yet-archived capture");
const index = [];
for (const name of readdirSync(dir).filter((p) => p.endsWith(".jsonl")).sort()) {
  const raw = resolve(dir, name), compressed = `${raw}.gz`, temp = `${compressed}.tmp`;
  if (existsSync(compressed) || existsSync(temp)) throw Error("Archive destination exists");
  const before = await hash(raw);
  await pipeline(createReadStream(raw), createGzip({ level: 6 }), createWriteStream(temp, { flags: "wx" }));
  const check = await hash(temp, true);
  if (check.sha256 !== before.sha256 || check.bytes !== before.bytes) throw Error("Gzip round-trip changed raw bytes");
  renameSync(temp, compressed); index.push({ name, original: before, compressed: await hash(compressed) });
  // A single verified file inside the explicit capture directory; no recursive deletion.
  unlinkSync(raw);
}
writeFileSync(resolve(dir, "archive.json"), JSON.stringify({ schema: "infraforge-pilot-archive/1", files: index }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ files: index.length, originalBytes: index.reduce((n, r) => n + r.original.bytes, 0), compressedBytes: index.reduce((n, r) => n + r.compressed.bytes, 0) }));
