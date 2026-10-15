import { requireKnown } from "../../reality/quantity";
import { copy } from "./copy";
import { commandService } from "../async/commands";
import { messageClient } from "../async/client";
import { systemService } from "./service";
import type { Deliver } from "../compute/run";
import type { EventKernel } from "../time";
import type { AddressRecord, AuthorityConfig, DnsReply, ResolverConfig } from "./contracts";
import { SYSTEM_LIMITS } from "./policy";

export const dnsName = (name: string) => name.toLowerCase().replace(/\.$/, "");
export const validDnsName = (name: string) => typeof name === "string" && name.length <= SYSTEM_LIMITS.nameCharacters && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.?$/i.test(name) && dnsName(name).split(".").every((label) => label.length > 0 && label.length <= 63);
export function dnsAuthority(config: AuthorityConfig, kernel: EventKernel) {
  const records = new Map(config.records.map((r) => [dnsName(r.name), copy(r)])); let queries = 0, negative = 0, updates = 0;
  const service = commandService(config.id, config, kernel, (work): DnsReply => {
    const request = work.message?.request as { kind: string; name: string } | undefined;
    if (!request || !validDnsName(request.name)) return { ok: false, reason: "invalid-dns-query", name: "", authority: config.id };
    const name = dnsName(request.name); queries++;
    const r = records.get(name); if (!r) { negative++; return { ok: false, reason: "nxdomain", name, authority: config.id, expiresAt: kernel.now + requireKnown(config.negativeTtl, "us") }; }
    return { ok: true, name, addresses: [...r.addresses], generation: r.generation, authority: config.id, expiresAt: kernel.now + requireKnown(r.ttl, "us") };
  });
  return { ...service, update(record: AddressRecord) { const name = dnsName(record.name), previous = records.get(name); if (previous && record.generation <= previous.generation) throw Error("DNS generation must advance"); if (!previous && records.size >= SYSTEM_LIMITS.entries) throw Error("DNS record budget"); records.set(name, copy(record)); updates++; }, evidence: () => ({ id: config.id, queries, negative, updates, records: [...records.values()].map((r) => copy(r)), service: service.evidence() }) };
}
export function dnsResolver(config: ResolverConfig, kernel: EventKernel, send: Deliver) {
  const cache = new Map<string, { reply: DnsReply; expires: number; cancel(): boolean }>();
  let queries = 0, hits = 0, misses = 0, upstream = 0, failures = 0, fills = 0, expirations = 0, evictions = 0, replaced = 0;
  const remove = (key: string) => { const e = cache.get(key); if (e) { e.cancel(); cache.delete(key); } };
  const service = systemService(config.id, config, kernel, (work, done) => {
    const request = work.message?.request as { kind: string; name: string }; if (!request || !validDnsName(request.name)) { done({ ok: false, reason: "invalid-dns-query" }); return; }
    const name = dnsName(request.name); queries++; const cached = cache.get(name);
    if (cached && cached.expires > kernel.now) { hits++; cache.delete(name); cache.set(name, cached); done(copy(cached.reply)); return; }
    misses++; upstream++; const ask = messageClient(work, send);
    const receipt = ask<DnsReply>(config.authority, { kind: "resolve", name }, (reply, outcome) => {
      if (!reply || (outcome !== "completed" && reply.reason !== "nxdomain")) { failures++; done({ ok: false, reason: "authority-unavailable" }); return; }
      if (!reply.ok) failures++;
      if (reply.expiresAt !== undefined && reply.expiresAt > kernel.now && (reply.ok || reply.reason === "nxdomain")) {
        if (cache.has(name)) { remove(name); replaced++; }
        while (cache.size >= requireKnown(config.cacheEntries, "count")) { remove(cache.keys().next().value!); evictions++; }
        const entry = { reply: copy(reply), expires: reply.expiresAt, cancel: () => false };
        entry.cancel = kernel.schedule(entry.expires, 0, JSON.stringify(["dns-expire", config.id, name, fills]), () => { if (cache.get(name) === entry) { cache.delete(name); expirations++; } }); cache.set(name, entry); fills++;
      }
      done(reply);
    }); return () => { receipt.cancel(); };
  });
  return { ...service, peek(name: string) { const entry = cache.get(dnsName(name)); return entry && entry.expires > kernel.now ? copy(entry.reply) : undefined; }, evidence: () => ({ id: config.id, queries, hits, misses, authoritativeLookups: upstream, failures, fills, expirations, evictions, replaced, cache: [...cache.entries()].map(([name, e]) => ({ name, expiresAt: e.expires, answer: copy(e.reply) })), service: service.serviceEvidence() }) };
}
