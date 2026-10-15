import { createServer } from "node:http";
import { request } from "node:http";
import { createServer as secureServer, connect as secureConnect } from "node:tls";
import { connect } from "node:net";
import { createSocket } from "node:dgram";
import { Resolver } from "node:dns/promises";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmdirSync, readdirSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { tmpdir, platform, release, cpus } from "node:os";
import { performance } from "node:perf_hooks";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex"), digest = (bytes) => `sha256:${hash(bytes)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { schema: "infraforge-systems-observations/1", run: randomUUID(), date: new Date().toISOString(), sourceHash: hash(readFileSync(new URL(import.meta.url))), host: { node: process.version, platform: platform(), release: release(), cpu: cpus()[0].model }, scope: "Disposable loopback native DNS/TLS and independent HTTP references; semantic observations only, no timing fit or cloud/product certification", dns: {}, tls: {}, cdn: [], registry: {}, telemetry: {}, cleanup: { complete: false, errors: [] } };
report.campaignComplete = false;
report.configuration = { classification: "explicit-experiment-stimulus", freeMode: "forbidden", dnsTtlSeconds: 1, dnsClientTimeoutMs: 100, dnsExpiryWaitMs: 1100, httpDeadlineMs: 3000, tlsDeadlineMs: 2000, tlsRsaBits: 2048, labCertDays: 1, coldBurst: 16, originInjectedWaitMs: 20, cacheTtlMs: 5000, expiryOverrideMs: 40, expiryWaitMs: 70, objectSizesBytes: [128, 4096, 65536], telemetryBufferSamples: 3, telemetryBatchSamples: 2, exportAttempts: 2 };
const owned = [], sockets = new Set(); let directory;
const listen = async (server) => { server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); }); await new Promise((r) => server.listen(0, "127.0.0.1", r)); owned.push(server); return server.address().port; };
const call = (port, path, method = "GET", body) => new Promise((resolveCall) => {
  const started = performance.now(); const req = request({ hostname: "127.0.0.1", port, path, method, agent: false, timeout: 3000 }, (res) => { const chunks = []; res.on("data", (b) => chunks.push(b)); res.on("end", () => { const bytes = Buffer.concat(chunks); resolveCall({ status: res.statusCode, bytes, durationMs: performance.now() - started }); }); });
  req.on("timeout", () => req.destroy(new Error("reference-timeout"))); req.on("error", (error) => resolveCall({ status: 0, bytes: Buffer.alloc(0), error: error.code ?? error.message, durationMs: performance.now() - started })); if (body) req.write(body); req.end();
});
try {
  // No system resolver configuration is changed; this client has one owned server.
  const dns = createSocket("udp4"); let available = true, value = [192, 0, 2, 10], queries = 0;
  dns.on("message", (message, peer) => { queries++; if (!available) return; let end = 12; while (message[end]) end += message[end] + 1; end += 5; const question = message.subarray(12, end), header = Buffer.alloc(12); message.copy(header, 0, 0, 2); header.writeUInt16BE(0x8500, 2); header.writeUInt16BE(1, 4); header.writeUInt16BE(1, 6); const answer = Buffer.alloc(16); answer.writeUInt16BE(0xc00c, 0); answer.writeUInt16BE(1, 2); answer.writeUInt16BE(1, 4); answer.writeUInt32BE(1, 6); answer.writeUInt16BE(4, 10); Buffer.from(value).copy(answer, 12); dns.send(Buffer.concat([header, question, answer]), peer.port, peer.address); });
  await new Promise((r) => dns.bind(0, "127.0.0.1", r)); owned.push(dns); const resolver = new Resolver({ timeout: 100, tries: 1 }); resolver.setServers([`127.0.0.1:${dns.address().port}`]);
  let cache; const lookup = async () => { if (cache && cache.expires > performance.now()) return { hit: true, answer: cache.answer }; const answer = await resolver.resolve4("app.lab.test", { ttl: true }); cache = { answer, expires: performance.now() + answer[0].ttl * 1000 }; return { hit: false, answer }; };
  const first = await lookup(); available = false; const cachedDuringFailure = await lookup(); await sleep(1100); let expiredFailure; try { await lookup(); expiredFailure = "unexpected-success"; } catch (e) { expiredFailure = e.code; } available = true; value = [192, 0, 2, 20]; const afterRecovery = await lookup();
  report.dns = { first, cachedDuringFailure, expiredFailure, afterRecovery, wireQueries: queries, boundary: "Native Node/c-ares UDP A query and explicit client cache wrapper; no recursive delegation/negative cache/connection-lifetime certification" };
  if (!cachedDuringFailure.hit || expiredFailure === "unexpected-success" || afterRecovery.answer[0].address !== "192.0.2.20") throw Error("DNS semantic observation failed");

  const openssl = existsSync("C:/Program Files/Git/usr/bin/openssl.exe") ? "C:/Program Files/Git/usr/bin/openssl.exe" : "openssl";
  directory = mkdtempSync(join(tmpdir(), "infraforge-m2g-")); const key = join(directory, "key.pem"), cert = join(directory, "cert.pem");
  report.tls.openssl = execFileSync(openssl, ["version"], { encoding: "utf8" }).trim();
  execFileSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-subj", "/CN=lab.test", "-addext", "subjectAltName=DNS:lab.test", "-days", "1"], { stdio: "pipe" });
  let applicationDeliveries = 0, handshakeErrors = 0; const secure = secureServer({ key: readFileSync(key), cert: readFileSync(cert), minVersion: "TLSv1.3", maxVersion: "TLSv1.3" }, (socket) => socket.on("data", () => { applicationDeliveries++; socket.end("accepted"); })); secure.on("tlsClientError", () => handshakeErrors++); const securePort = await listen(secure);
  const handshake = (name, trust) => new Promise((r) => { const started = performance.now(), socket = secureConnect({ host: "127.0.0.1", port: securePort, servername: name, ca: trust ? readFileSync(cert) : undefined, rejectUnauthorized: true, minVersion: "TLSv1.3", maxVersion: "TLSv1.3" }); let result;
    socket.setTimeout(2000, () => socket.destroy(new Error("handshake-timeout"))); socket.once("secureConnect", () => { result = { accepted: true, protocol: socket.getProtocol(), fingerprint: socket.getPeerCertificate().fingerprint256 }; socket.write("request"); }); socket.on("data", () => {}); socket.once("error", (e) => { result = { accepted: false, reason: e.code ?? e.message }; }); socket.once("close", () => r({ ...result, durationMs: performance.now() - started })); });
  const compatible = await handshake("lab.test", true), wrongName = await handshake("wrong.lab.test", true), untrusted = await handshake("lab.test", false);
  await new Promise((r) => { const socket = connect(securePort, "127.0.0.1", () => socket.write("GET / HTTP/1.0\r\n\r\n")); socket.on("error", () => {}); socket.on("close", r); socket.setTimeout(2000, () => socket.destroy()); });
  report.tls = { ...report.tls, compatible, wrongName, untrusted, plaintextRejected: applicationDeliveries === 1, applicationDeliveries, handshakeErrors, boundary: "Native TLS1.3 exact SAN/trust checks; lab certificate only; no fitted TLS CPU/latency" };
  if (!compatible.accepted || wrongName.accepted || untrusted.accepted || applicationDeliveries !== 1) throw Error("TLS semantic observation failed");

  let originAvailable = true, originCalls = 0; const objects = new Map(), blobs = new Map(), manifests = new Map(), tags = new Map(), telemetry = new Map(); let telemetryAvailable = true;
  const origin = createServer((req, res) => { const chunks = []; req.on("data", (b) => chunks.push(b)); req.on("end", () => { const body = Buffer.concat(chunks), path = req.url;
    if (path.startsWith("/object/")) { originCalls++; if (!originAvailable) { res.writeHead(503).end(); return; } const object = objects.get(path); setTimeout(() => { if (!object) res.writeHead(404).end(); else res.end(object); }, 20); return; }
    if (path.startsWith("/v2/blobs/")) { const id = path.slice(10); if (req.method === "PUT") { if (digest(body) !== id) { res.writeHead(400).end(); return; } if (!blobs.has(id)) blobs.set(id, body); res.writeHead(201).end(); } else { const blob = blobs.get(id); if (blob) res.end(blob); else res.writeHead(404).end(); } return; }
    if (path.startsWith("/v2/manifests/")) { const reference = path.slice(14); if (req.method === "PUT") { const manifest = JSON.parse(body); if (digest(body) !== reference || manifest.layers.some((b) => blobs.get(b.digest)?.length !== b.bytes)) { res.writeHead(400).end(); return; } manifests.set(reference, body); res.writeHead(201).end(); } else { const value = manifests.get(tags.get(reference) ?? reference); if (value) res.end(value); else res.writeHead(404).end(); } return; }
    if (path === "/metrics") { res.end(JSON.stringify({ originCalls, available: originAvailable, measuredAt: performance.now() })); return; }
    if (path === "/telemetry") { if (!telemetryAvailable) { res.writeHead(503).end(); return; } for (const sample of JSON.parse(body)) if (!telemetry.has(sample.id)) telemetry.set(sample.id, { ...sample, arrivedAt: performance.now() }); res.end("accepted"); return; }
    res.writeHead(404).end();
  }); }); const port = await listen(origin);
  for (const size of [128, 4096, 65536]) for (const coalesce of [false, true]) {
    objects.set("/object/asset", Buffer.alloc(size, 7)); let cache, filling, hits = 0, misses = 0, fetches = 0; const before = originCalls;
    const get = async () => { if (cache && cache.expires > performance.now()) { hits++; return { status: 200, bytes: cache.body }; } misses++; const fetch = async () => { fetches++; const response = await call(port, "/object/asset"); if (response.status === 200) cache = { body: response.bytes, expires: performance.now() + 5000 }; return response; }; if (!coalesce) return fetch(); if (!filling) filling = fetch().finally(() => { filling = undefined; }); return filling; };
    const cold = await Promise.all(Array.from({ length: 16 }, get)); originAvailable = false; const warm = await get(); cache.expires = performance.now() + 40; await sleep(70); const expired = await get(); originAvailable = true; const recovered = await get();
    const row = { size, concurrency: 16, coalesce, hits, misses, fetches, actualOriginCalls: originCalls - before, coldBodies: cold.map((r) => ({ status: r.status, bytes: r.bytes.length, hash: hash(r.bytes) })), warmDuringOutage: warm.status, expiredDuringOutage: expired.status, recovered: recovered.status, storedBytes: cache.body.length, timingClaim: "Unknown; TTL/collapse/byte semantic experiment only" }; report.cdn.push(row);
    if (warm.status !== 200 || expired.status !== 503 || recovered.status !== 200 || cold.some((r) => r.bytes.length !== size) || fetches !== (coalesce ? 3 : 18)) throw Error("CDN semantic observation failed");
  }
  const layerBodies = [Buffer.alloc(128, 1), Buffer.alloc(4096, 2), Buffer.alloc(65536, 3)], layerRows = layerBodies.map((b) => ({ digest: digest(b), bytes: b.length }));
  for (const [index, body] of layerBodies.entries()) if ((await call(port, `/v2/blobs/${layerRows[index].digest}`, "PUT", body)).status !== 201) throw Error("Blob upload failed");
  await call(port, `/v2/blobs/${layerRows[0].digest}`, "PUT", layerBodies[0]);
  const imageBodies = [[layerRows[0], layerRows[1]], [layerRows[0], layerRows[2]]].map((layers) => Buffer.from(JSON.stringify({ layers }))), imageIds = imageBodies.map(digest);
  for (const [index, body] of imageBodies.entries()) if ((await call(port, `/v2/manifests/${imageIds[index]}`, "PUT", body)).status !== 201) throw Error("Manifest publication failed"); tags.set("latest", imageIds[0]);
  const pull = async (reference, cache) => { const response = await call(port, `/v2/manifests/${reference}`), manifest = JSON.parse(response.bytes); let transferred = 0, reused = 0; for (const layer of manifest.layers) { if (cache.has(layer.digest)) { reused++; continue; } const blob = await call(port, `/v2/blobs/${layer.digest}`); if (blob.status !== 200 || digest(blob.bytes) !== layer.digest || blob.bytes.length !== layer.bytes) throw Error("Layer identity failure"); cache.set(layer.digest, blob.bytes.length); transferred += blob.bytes.length; } return { transferred, reused, cachedBytes: [...cache.values()].reduce((a, b) => a + b, 0) }; };
  const cacheA = new Map(), cacheB = new Map(), firstPull = await pull("latest", cacheA), secondSameNode = await pull("latest", cacheA), freshNode = await pull("latest", cacheB); tags.set("latest", imageIds[1]); const sharedImage = await pull("latest", cacheA);
  report.registry = { layers: layerRows, imageIds, manifests: imageBodies.map((body, index) => ({ digest: imageIds[index], bytes: body.length, layers: JSON.parse(body).layers })), blobCount: blobs.size, storedBlobBytes: [...blobs.values()].reduce((n, b) => n + b.length, 0), manifestCount: manifests.size, tag: tags.get("latest"), firstPull, secondSameNode, freshNode, sharedImage, boundary: "Independent HTTP graph reference with real SHA256 buffers, not a complete OCI server or image runtime" };
  if (secondSameNode.transferred !== 0 || sharedImage.reused !== 1 || blobs.size !== 3) throw Error("Registry reuse observation failed");
  const buffered = [], dropped = []; let generated = 0, exported = 0, payloadBytes = 0; telemetryAvailable = false;
  const collect = async () => { const response = await call(port, "/metrics"), observation = JSON.parse(response.bytes), sample = { id: `sample-${generated++}`, measuredAt: observation.measuredAt, collectedAt: performance.now(), values: observation, attempts: 0 }; if (buffered.length === 3) dropped.push(sample.id); else buffered.push(sample); };
  const flush = async () => { const batch = buffered.splice(0, 2); if (!batch.length) return; for (const s of batch) s.attempts++; const payload = Buffer.from(JSON.stringify(batch)); payloadBytes += payload.length; const response = await call(port, "/telemetry", "POST", payload); if (response.status === 200) exported += batch.length; else for (const s of batch) { if (s.attempts < 2) buffered.push(s); else dropped.push(s.id); } };
  for (let n = 0; n < 12; n++) { await collect(); if (n % 3 === 2) await flush(); } telemetryAvailable = true; while (buffered.length) await flush(); await collect(); await flush();
  report.telemetry = { generated, exported, droppedIds: dropped, buffered: buffered.length, backend: [...telemetry.values()], payloadBytes, boundary: "Explicit native HTTP metric collection and memory-only bounded batch exporter; no OTel protocol/persistence certification" };
  if (generated !== exported + dropped.length + buffered.length || [...telemetry.keys()].some((id) => dropped.includes(id))) throw Error("Telemetry conservation failed");
  report.environmentHash = hash(JSON.stringify({ host: report.host, openssl: report.tls.openssl, scope: report.scope }));
  report.campaignComplete = true;
} finally {
  for (const socket of sockets) socket.destroy();
  for (const server of owned.reverse()) try { await new Promise((r, reject) => { try { server.close((error) => error ? reject(error) : r()); } catch (e) { reject(e); } }); } catch (error) { report.cleanup.errors.push(String(error)); }
  if (directory) try { if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("infraforge-m2g-")) throw Error("Certificate cleanup ownership mismatch"); const files = readdirSync(directory); if (files.some((f) => !["key.pem", "cert.pem"].includes(f))) throw Error("Unexpected certificate fixture file"); for (const name of files) unlinkSync(join(directory, name)); rmdirSync(directory); } catch (error) { report.cleanup.errors.push(String(error)); }
  report.cleanup.complete = report.cleanup.errors.length === 0; writeFileSync(new URL("../../docs/reality/m2g-measurements.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify({ run: report.run, dns: report.dns, tls: report.tls, cdnCases: report.cdn.length, registry: report.registry, telemetry: { generated: report.telemetry.generated, exported: report.telemetry.exported, dropped: report.telemetry.droppedIds.length }, cleanup: report.cleanup }));
