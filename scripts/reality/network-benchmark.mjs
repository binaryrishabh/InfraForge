import net from "node:net";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { cpus, platform, release, arch } from "node:os";

// A controlled whole-message application pacer over loopback, not a WAN/TCP model.
const now = () => Number(process.hrtime.bigint()) / 1000;
const frame = (id, bytes) => { const b = Buffer.alloc(bytes + 8, 97); b.writeUInt32BE(bytes + 4); b.writeUInt32BE(id, 4); return b; };
const parse = (socket, receive) => { let pending = Buffer.alloc(0); socket.on("data", (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= 4 && pending.length >= pending.readUInt32BE() + 4) { const size = pending.readUInt32BE() + 4, message = pending.subarray(0, size); pending = pending.subarray(size); receive(message); }
}); };
function pacer(rate) {
  const queue = []; let active = false, timer;
  const pump = () => { if (active || !queue.length) return; active = true; const job = queue.shift();
    timer = setTimeout(() => { active = false; job.done(); pump(); }, job.bytes * 1000 / rate);
  };
  return { send(bytes, done) { queue.push({ bytes, done }); pump(); }, stop() { clearTimeout(timer); queue.length = 0; } };
}
async function observe(config, repeat) {
  const sockets = new Set(), request = pacer(config.rate), response = pacer(config.rate);
  let acceptedConnections = 0;
  const server = net.createServer((s) => { sockets.add(s); acceptedConnections++; s.setNoDelay(true); s.on("error", () => {}); s.on("close", () => sockets.delete(s));
    parse(s, (message) => { const id = message.readUInt32BE(4); request.send(message.length, () => response.send(config.payload * 2 + 8, () => { if (!s.destroyed) s.write(frame(id, config.payload * 2)); })); });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port, results = [], connects = [], pool = [], waiting = [];
  let issued = 0, active = 0, connecting = 0, finished = 0, created = 0;
  const start = now(), cpuStart = process.cpuUsage(); let deadline;
  try {
    await new Promise((resolve, reject) => {
      deadline = setTimeout(() => reject(Error("Bounded loopback observation timed out")), 30000);
      const issue = () => { while (active < config.concurrency && issued < 32) { const id = issued++; active++; waiting.push({ id, at: now() }); } pump(); };
      const dispatch = (c, job) => { c.job = job; c.socket.write(frame(job.id, config.payload)); };
      const connect = () => {
        connecting++; created++; const at = now(), s = net.createConnection({ host: "127.0.0.1", port }); sockets.add(s); s.setNoDelay(true);
        const c = { socket: s, job: null }; pool.push(c);
        s.on("error", reject); s.on("close", () => sockets.delete(s));
        s.once("connect", () => { connecting--; connects.push(now() - at); c.ready = true; pump(); });
        parse(s, (message) => {
          const job = c.job; if (!job || message.readUInt32BE(4) !== job.id) { reject(Error("Mismatched echo ownership")); return; }
          results.push({ id: job.id, offeredUs: job.at - start, responseUs: now() - job.at }); c.job = null; active--; finished++;
          if (!config.reuse) { c.closed = true; s.destroy(); }
          if (finished === 32) resolve(); else issue();
        });
      };
      function pump() {
        for (const c of pool) if (c.ready && !c.closed && !c.job && waiting.length) dispatch(c, waiting.shift());
        const live = pool.filter((c) => !c.closed).length;
        if (waiting.length && live < config.pool && connecting < waiting.length) { connect(); pump(); }
      }
      issue();
    });
    const wallUs = now() - start, cpu = process.cpuUsage(cpuStart);
    return { id: `${config.id}/${repeat}`, config: config.id, repeat, split: config.holdout || repeat === 2 ? "holdout" : "fit", configurationHoldout: config.holdout,
      operations: 32, wallUs, throughput: 32000000 / wallUs, processCpuUs: cpu.user + cpu.system, created, acceptedConnections, connectsUs: connects,
      requestBytes: 32 * (config.payload + 8), responseBytes: 32 * (config.payload * 2 + 8), results: results.sort((a, b) => a.id - b.id) };
  } finally { clearTimeout(deadline); request.stop(); response.stop(); for (const s of sockets) s.destroy(); await new Promise((resolve) => server.close(resolve)); }
}

const configurations = [];
for (const rate of [1048576, 4194304]) for (const payload of [64, 4096, 65536]) for (const reuse of [true, false]) for (const pool of [1, 4]) {
  configurations.push({ id: `${rate}/${payload}/${reuse}/${pool}/8`, rate, payload, reuse, pool, concurrency: 8, holdout: payload === 4096 });
}
for (const payload of [64, 4096, 65536]) for (const reuse of [true, false]) configurations.push({ id: `1048576/${payload}/${reuse}/2/4`, rate: 1048576, payload, reuse, pool: 2, concurrency: 4, holdout: true });
const host = { scope: "owner-local-loopback-only", node: process.version, platform: platform(), release: release(), arch: arch(), cpu: cpus()[0].model };
const report = { schema: "infraforge-network-observations/1", date: new Date().toISOString(), sourceHash: createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex"),
  environment: createHash("sha256").update(JSON.stringify(host)).digest("hex"), host,
  method: "Whole-message FIFO JS timer pacers per direction over net.Socket loopback; 32 closed-loop jobs; 8-byte framing; asymmetric response payload; no TLS; setNoDelay; timer quantization/runtime included; no physical bandwidth/RTT identification",
  configurations, records: [] };
// Warm the same framing/socket/pacer path before retaining observations.
await observe({ ...configurations[0], concurrency: 1 }, -1);
for (const config of configurations) {
  for (let repeat = 0; repeat < 3; repeat++) report.records.push(await observe(config, repeat));
  console.log(JSON.stringify({ measured: config.id, batches: report.records.length }));
}
writeFileSync(new URL("../../docs/reality/m2d-measurements.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ complete: true, batches: report.records.length, operations: report.records.reduce((n, r) => n + r.operations, 0), sourceHash: report.sourceHash }));
