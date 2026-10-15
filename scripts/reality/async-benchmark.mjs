import { createServer, request as httpRequest, Agent } from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { cpus, platform, release } from "node:os";
const run = randomUUID().replaceAll("-", ""), name = `infraforge-m2f-${run}-broker`;
const labels = { "infraforge.project": "binaryrishabh/InfraForge", "infraforge.purpose": "m2f-measurement", "infraforge.run": run, "infraforge.temporary": "true" };
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", timeout: 30000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
const context = docker("context", "show"), endpoint = JSON.parse(docker("context", "inspect", context))[0].Endpoints.docker.Host;
if (process.env.DOCKER_HOST || !/^(npipe:\/\/|unix:\/\/)/.test(endpoint)) throw Error("Local Docker pipe/socket required");
const clock = () => Number(process.hrtime.bigint()) / 1000, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { schema: "infraforge-async-observations/1", date: new Date().toISOString(), run, sourceHash: createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex"), host: { node: process.version, platform: platform(), release: release(), cpu: cpus()[0].model }, broker: [], objects: [], semantics: {}, cleanup: { complete: false } };
const agents = [], objects = new Map(); let generation = 0, server, created = false;
const call = (port, method, path, body = Buffer.alloc(0), agent, headers = {}) => new Promise((resolve, reject) => {
  const at = clock(), req = httpRequest({ host: "127.0.0.1", port, method, path, agent, headers: { "content-length": body.length, ...headers } }, (res) => { const chunks = []; res.on("data", (b) => chunks.push(b)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks), responseUs: clock() - at, reused: req.reusedSocket })); });
  req.setTimeout(10000, () => req.destroy(Error("Fixture request timeout"))); req.on("error", reject); req.end(body);
});
try {
  const args = Object.entries(labels).flatMap(([k, v]) => ["--label", `${k}=${v}`]);
  docker("run", "-d", "--pull=never", "--name", name, ...args, "--cpus=1", "--publish", "127.0.0.1::15672", "--tmpfs", "/var/lib/rabbitmq", "--env", "RABBITMQ_DEFAULT_USER=m2f_local", "--env", "RABBITMQ_DEFAULT_PASS=m2f_disposable_fixture_only", "rabbitmq:4-management-alpine"); created = true;
  const inspect = JSON.parse(docker("inspect", name))[0], port = Number(inspect.NetworkSettings.Ports["15672/tcp"][0].HostPort), auth = `Basic ${Buffer.from("m2f_local:m2f_disposable_fixture_only").toString("base64")}`;
  const brokerAgent = new Agent({ keepAlive: true, maxSockets: 16 }); agents.push(brokerAgent);
  const api = async (method, path, body, agent = brokerAgent) => {
    const data = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body)), result = await call(port, method, path, data, agent, { authorization: auth, "content-type": "application/json" });
    if (result.status >= 300) throw Error(`Broker fixture API ${method} ${path}: ${result.status} ${result.bytes.toString().slice(0, 500)}`); return { ...result, data: result.bytes.length ? JSON.parse(result.bytes) : undefined, requestBytes: data.length };
  };
  let version;
  for (let i = 0; i < 120; i++) { try { version = (await api("GET", "/api/overview")).data.rabbitmq_version; break; } catch { await sleep(250); } }
  if (!version) throw Error("Disposable broker readiness failed");
  report.versions = { rabbitmq: version, image: inspect.Image, brokerBoundary: "HTTP management API; not AMQP throughput, publisher durable confirms or visibility leases", objectReference: "Independent Node HTTP current-object Map reference; actual byte buffers only in bounded measurement, not simulation", durability: "Unknown; broker tmpfs, durable queue metadata with transient messages, and object memory only" };
  server = createServer(async (req, res) => {
    const key = req.url, previous = objects.get(key);
    if (req.method === "PUT") {
      const chunks = []; let length = 0; for await (const chunk of req) { length += chunk.length; if (length > 65536) { res.writeHead(413).end(); return; } chunks.push(chunk); }
      const current = objects.get(key);
      if ((req.headers["if-none-match"] === "*" && current) || (req.headers["if-match"] && current?.generation !== Number(req.headers["if-match"]))) { res.writeHead(412).end(); return; }
      const value = { generation: ++generation, bytes: Buffer.concat(chunks) }; objects.set(key, value); res.writeHead(200, { etag: String(value.generation) }).end();
    } else if (req.method === "DELETE") { objects.delete(key); res.writeHead(204).end(); }
    else if (req.method === "GET" || req.method === "HEAD") { if (!previous) { res.writeHead(404).end(); return; } res.writeHead(200, { etag: String(previous.generation), "content-length": previous.bytes.length }).end(req.method === "HEAD" ? undefined : previous.bytes); }
    else res.writeHead(405).end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r)); const objectPort = server.address().port;
  const queue = "m2f", queuePath = `/api/queues/%2F/${queue}`;
  await api("PUT", queuePath, { durable: true, auto_delete: false, arguments: { "x-queue-type": "classic" } });
  const publish = (bytes, id, agent = brokerAgent) => api("POST", "/api/exchanges/%2F/amq.default/publish", { properties: { message_id: String(id), delivery_mode: 1 }, routing_key: queue, payload: Buffer.alloc(bytes, 97).toString("base64"), payload_encoding: "base64" }, agent);
  const get = (mode, count = 1, agent = brokerAgent) => api("POST", `${queuePath}/get`, { count, ackmode: mode, encoding: "base64", truncate: 65536 }, agent);
  const cpuUsage = () => Number(docker("exec", name, "cat", "/sys/fs/cgroup/cpu.stat").match(/usage_usec (\d+)/)[1]);
  for (const bytes of [64, 4096, 65536]) for (const concurrency of [1, 4, 8]) for (const kind of ["publish", "consume"]) for (let repeat = 0; repeat < 3; repeat++) {
    await api("DELETE", `${queuePath}/contents`); if (kind === "consume") for (let i = 0; i < 32; i++) await publish(bytes, i);
    const results = []; let next = 0; const before = cpuUsage(), start = clock();
    await Promise.all(Array.from({ length: concurrency }, async () => { while (next < 32) { const id = next++, r = kind === "publish" ? await publish(bytes, id) : await get("ack_requeue_false"); if (kind === "publish" ? !r.data.routed : r.data.length !== 1 || r.data[0].payload_bytes !== bytes) throw Error("Broker operation semantic mismatch"); results.push({ id, responseUs: r.responseUs, requestBytes: r.requestBytes, responseBytes: r.bytes.length, logicalId: kind === "publish" ? String(id) : r.data[0].properties.message_id }); } }));
    const wallUs = clock() - start, cpuUs = cpuUsage() - before;
    if (kind === "publish") { const drained = await get("ack_requeue_false", 32); if (drained.data.length !== 32) throw Error("Accepted broker population missing"); }
    if (new Set(results.map((r) => r.logicalId)).size !== 32) throw Error("Broker duplicate/missing logical identities");
    report.broker.push({ id: `${bytes}/${concurrency}/${kind}/${repeat}`, bytes, concurrency, kind, repeat, operations: 32, split: bytes === 4096 || concurrency === 4 || repeat === 2 ? "holdout" : "fit", configurationHoldout: bytes === 4096 || concurrency === 4, wallUs, throughput: 32000000 / wallUs, containerCpuUs: cpuUs, results: results.sort((a, b) => a.id - b.id) });
  }
  await publish(64, "redelivery"); const redeliveryA = await get("reject_requeue_true"), redeliveryB = await get("ack_requeue_false");
  report.semantics.broker = { firstId: redeliveryA.data[0].properties.message_id, secondId: redeliveryB.data[0].properties.message_id, redelivered: redeliveryB.data[0].redelivered, emptyAfterAck: (await get("ack_requeue_false")).data.length === 0, acknowledgementBoundary: "HTTP get endpoint performs ack/requeue action; no consumer prefetch/connection-crash lease claim" };
  for (const bytes of [64, 4096, 65536]) for (const concurrency of [1, 4, 8]) for (const kind of ["PUT", "GET"]) for (const reuse of [false, true]) {
    const agent = new Agent({ keepAlive: reuse, maxSockets: concurrency }); agents.push(agent);
    for (let repeat = 0; repeat < 3; repeat++) {
      objects.clear(); const body = Buffer.alloc(bytes, 98); if (kind === "GET") for (let i = 0; i < 32; i++) await call(objectPort, "PUT", `/object/${i}`, body, agent);
      const results = []; let next = 0; const before = process.cpuUsage(), start = clock();
      await Promise.all(Array.from({ length: concurrency }, async () => { while (next < 32) { const id = next++, r = await call(objectPort, kind, `/object/${id}`, kind === "PUT" ? body : undefined, agent); if (r.status !== 200 || (kind === "GET" && (!r.bytes.equals(body)))) throw Error("Object reference semantic mismatch"); results.push({ id, responseUs: r.responseUs, status: r.status, requestBytes: kind === "PUT" ? bytes : 0, responseBytes: r.bytes.length, reused: r.reused }); } }));
      const wallUs = clock() - start, cpu = process.cpuUsage(before);
      report.objects.push({ id: `${bytes}/${concurrency}/${kind}/${reuse}/${repeat}`, bytes, concurrency, kind, reuse, repeat, operations: 32, split: bytes === 4096 || concurrency === 4 || repeat === 2 ? "holdout" : "fit", configurationHoldout: bytes === 4096 || concurrency === 4, wallUs, throughput: 32000000 / wallUs, combinedNodeCpuUs: cpu.user + cpu.system, storedBytes: [...objects.values()].reduce((n, o) => n + o.bytes.length, 0), results: results.sort((a, b) => a.id - b.id) });
    }
    agent.destroy();
  }
  objects.clear(); const agent = new Agent({ keepAlive: true }); agents.push(agent); await call(objectPort, "PUT", "/proof", Buffer.from("old"), agent); const before = await call(objectPort, "GET", "/proof", undefined, agent);
  const conditions = await Promise.all(["first", "second"].map((v) => call(objectPort, "PUT", "/conditional", Buffer.from(v), agent, { "if-none-match": "*" })));
  await call(objectPort, "PUT", "/proof", Buffer.from("new-complete"), agent); const after = await call(objectPort, "GET", "/proof", undefined, agent); await call(objectPort, "DELETE", "/proof", undefined, agent);
  report.semantics.objects = { old: before.bytes.toString(), replacement: after.bytes.toString(), conditionalStatuses: conditions.map((r) => r.status).sort(), absentAfterDelete: (await call(objectPort, "GET", "/proof", undefined, agent)).status === 404, physicalPersistence: "Unknown; logical reference only" };
} catch (e) { report.error = String(e); throw e; }
finally {
  for (const agent of agents) agent.destroy(); if (server) { server.closeAllConnections(); await new Promise((r) => server.close(r)); } objects.clear(); const errors = [];
  if (created) try { const info = JSON.parse(docker("inspect", name))[0]; if (Object.entries(labels).some(([k, v]) => info.Config.Labels[k] !== v)) throw Error("Broker fixture ownership mismatch"); docker("rm", "-f", name); } catch (e) { errors.push(String(e)); }
  report.cleanup = { complete: errors.length === 0, errors }; report.environment = createHash("sha256").update(JSON.stringify({ host: report.host, versions: report.versions })).digest("hex");
  writeFileSync(new URL("../../docs/reality/m2f-measurements.json", import.meta.url), JSON.stringify(report, null, 2) + "\n"); if (errors.length) throw Error("Owned fixture cleanup incomplete");
}
console.log(JSON.stringify({ complete: true, brokerBatches: report.broker.length, objectBatches: report.objects.length, semantics: report.semantics, cleanup: report.cleanup }));
