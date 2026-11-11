# Saved capabilities added in the next-lane window

Each capability below is an optional saved setting captured as a named adapter profile. Omitting it keeps the earlier compiled bytes, published hashes and recorded output. Every value is an educational authored input, never a measured provider behavior, and missing evidence stays Unknown rather than zero.

## DNS single-name publication (`dns-publication/1`)
Saved DNS setting `dnsPublication {version 1, initialRecord "absent"}`. The one modeled name starts without a record; a scripted publish makes the first answer possible, and resolver negative caching then decides when callers can resolve it. Evidence is the authority and resolver summaries and the first successful answer time. Limits: one name, no delegation hierarchy, CNAME, DNSSEC, failover or health routing. A first successful answer is not first admitted traffic, continuous health or a propagation benchmark. Established connections keep their binding.

## Artifact cache capacity (`artifact-cache/1`)
Saved `artifactCachePolicy {version 1, capacityBytes}` on an autoscaled VM binds one byte capacity to every owned artifact client. An initial deployed replica stays ready without a pull; later replicas acquire the assumed layer. A layer larger than the remaining capacity is refused with `node-blob-cache-capacity`, and retries cannot make it fit. Capacity failure can never mark an artifact or listener ready. Limits: one assumed layer, no image-pull speed or network transfer model, no eviction, prewarming, shared-host reuse or rollout. The `startup-capacity` criterion counts later replicas with a measured listener that are currently load-balancer eligible at one second; it does not show continuous health or first traffic.

## Autoscaling from delivered samples (`autoscaling-observed/1`)
Saved autoscaling `signal {version 1, source "observed-core-time", monitorId, freshForSeconds, stale "hold"}`. The pool controller scales only on core-time samples the named monitoring backend has received within the freshness bound; missing, old or incomplete samples hold the current desired count. Limits: one source and one stale policy, freshness at most 60 seconds, no provider metric semantics, no scale-down guarantee. Delivery cadence and buffering belong to the monitoring settings.

## Gateway quota scope (`gateway-quota/1`)
Saved `gatewayQuota {version 1, scope "shared" | "per-route"}` on an API Gateway with at least two explicit routes whose burst and refill are equal. Shared means one token bucket for all routes; per-route means one per route. Limits: equal budgets only, no weighted fairness or starvation guarantee, no tenant or key identity. Results show coupling between routes under a fixed workload, not general fairness.

## Worker external wait (`worker-wait/1`)
Saved `asyncWorker.externalWaitMs` (0 to 60000) adds a per-job wait after CPU work. The job keeps its parallel slot, prefetch credit and lease but spends no CPU while waiting. Limits: one authored wait for every job of that worker, no connection pool, timeout, retry or provider behavior on the outside call, no per-class slow jobs, a larger VM adds cores and not slots.

## Queue repair and redrive (`queue-redrive/1`)
Saved `asyncWorker.repairAtSecond` stops poison selection at that second; saved `asyncQueue.redriveAtSecond` returns dead-lettered messages to ready once at that second. Redriving before the repair re-dead-letters them. Limits: one timed repair and one redrive, no new message identity beyond the existing receipt rules, no ordering, exactly-once or durability claim, and cumulative dead-lettered counts are not current dead-letter depth.

## Load balancer admission in use (`lb-admission/1`, existing)
`lbAdmission {maxActive, maxQueued, queueWaitMs}` already compiled; two labs now use it. Lowering Active requests sheds excess demand and bounds the tail of admitted requests; raising it opens a forwarding gate that was serializing spare backend capacity. Limits: admission chooses who waits and adds no capacity; clients that back off are not modeled.

## What these notes do not claim
No capability here implies cloud-provider fidelity, an availability guarantee, a whole-run latency target or cost accuracy. Each lab reads fixed-second samples and states its own limitations in its lesson.

## Replica staleness evidence (`stale-reads` criterion, existing saved delay)
The saved `databaseReplication.replicationDelayMs` (1 to 60000) already set how long a replica applies each writer commit after it. Read routing records `staleReads` and `maxStaleReadAgeMs`. The `stale-reads` challenge criterion compares the cumulative stale read count at one exact second with a bounded limit and is not evaluated when the named replicated database, the exact second or the counters are missing or malformed. Limits: counters are cumulative, include health probes and describe modeled row versions only; the delay is an authored constant, so a real replica's varying lag is not modeled; nothing here shows application consistency or read-your-writes.

## Cache capacity and lifetime in use (`data-cache-capacity/1`, `data-cache-policy/1`, existing)
`cachePolicy {version 2, capacityEntries, ttlSeconds, singleFlight}` already compiled. `fit-the-working-set` uses capacity when a uniform working set exceeds the cache (evictions), the mirror of `reuse-before-expiry` (expiry with room to spare). A TTL of 60 seconds is the unmarked default; any other TTL is captured as `data-cache-policy/1`, so a design pair must differ in TTL consistently or the comparison degrades to side-by-side. Limits: counters are cache commands, not a caller hit ratio; no writes, invalidation or freshness requirement; entries are logical.

## CDN single shared origin fetch (`cdn-coalescing/1`, existing)
`cdnCachePolicy {version 2, ttlSeconds, coalesce, maxWaiters}` lets requests that miss the same object during a refill share one origin fetch. `share-one-origin-fetch` compares origin requests with coalescing off and on. Limits: one object, fixed request rate and object size, no geographic edges, purge propagation or stale serving; fewer origin requests show no freshness or user-impact result by themselves.

## Serverless warm-instance retention (`serverless/1`, existing `idleExpiryMs`)
`serverless {version 1, concurrency, initializationMs, durationMs, timeoutMs, idleExpiryMs}`. A call after the idle window pays initialization again. `keep-a-function-warm` separates idle expiry from a concurrency ceiling using the `function-reuse` criterion (completed calls, cold starts, unsuccessful calls). Limits: exact idle retention is an educational saved control, not a provider contract; the first call is always cold; function CPU, memory and cost are not modeled; no prewarming or provisioned concurrency.

## Event bus dead-letter capacity (`event-bus/1`, existing `deadLetterCapacity`)
`eventBus {version 1, retryDelayMs, maxAttempts, deadLetterCapacity}`. After the delivery attempts are used, the dead-letter list is the only retained copy of a failed event; a full list discards the rest. `keep-failed-events` uses the `bus-dead-letters` criterion. Limits: one subscriber failure mode, no redrive for the bus, no ordering or exactly-once claim; raising attempts does not enlarge the list.

## Monitoring collection interval (`monitor-cadence/1`, existing `collectionIntervalSeconds`)
`monitoringPolicy {version 2, collectionIntervalSeconds, exportIntervalSeconds, bufferSamples, batchSamples, exportAttempts}`. A sample cannot be newer than the last collection, so exporting more often does not freshen it. `sample-often-enough` changes only the collection interval. Limits: one agent and backend, authored cadences, no provider metric resolution, no alert evaluation; delivery of one sample is not continuous coverage.

## Multi-cause cascade tracing (`trace-a-slowdown-cascade`)
A reading and diagnosis lab over existing evidence: a scripted three-second database slowdown, retries, cache and pool effects recorded separately. It adds no saved setting. Limits: one scripted incident, a fixed-second sample, no root-cause automation and no claim that the cut chosen generalizes to other designs.

## Load balancer rate limit in use (`lb-rate-limit/1`, existing)
`lbRateLimit {version 1, burstRequests, sustainedRequestsPerSecond}` is a token bucket at the balancer: the burst is spent first, then admission follows the sustained refill. `set-the-limit-above-the-peak` uses a scripted legitimate peak above the sustained rate; refusals appear as failed callers while app CPU stays low. Limits: one bucket for all callers, no per client identity, fairness or abuse model; a rate limit is a policy, not capacity, and no availability guarantee follows from one run.
