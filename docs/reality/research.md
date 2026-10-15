# Research basis and limits

Researched 2026-10-15. Public documentation only; no cloud accounts, production
infrastructure or provider APIs. Sources support the specific properties below,
not the proof's synthetic numeric workload. Snapshot facts need rechecking before use.

| Primary evidence | Supported claim and design consequence |
| --- | --- |
| [Google SRE: overload](https://sre.google/sre-book/handling-overload/) | Query count is a poor proxy when demand differs; normalize capacity consumption and bound retries. Separate capability from class-specific service demand. |
| [MIT queueing relationships](https://web.mit.edu/urban_or_book/www/book/chapter4/4.4.html) | Little's law concerns consistent populations and long-run averages; admitted rate matters with rejection. Use finite-horizon conservation identities as tests; never apply a steady-state mean formula to an arbitrary transient screenshot. |
| [The Tail at Scale](https://research.google/pubs/the-tail-at-scale/) | Fanout and variable service time affect tails. Means and CPU percentages do not establish p99. M2A does not claim tail calibration. |
| [SimPy time/scheduling](https://simpy.readthedocs.io/en/latest/topical_guides/time_and_scheduling.html), [ns-3 events](https://www.nsnam.org/docs/manual/html/events.html) | Sequential virtual events and explicit equal-time ordering support deterministic replay. Our priority/stable-key policy is an authored choice, not copied physical truth. |
| [Random123 paper](https://www.thesalmons.org/john/random123/papers/random123sc11.pdf), [official vectors](https://raw.githubusercontent.com/DEShawResearch/random123/main/tests/kat_vectors) | Counter/key generators avoid mutable shared draw order. Philox4x32-10 core is checked against three vectors. Tuple hashing and stream identity are our versioned policy; statistical independence of hashed names is not proven. |
| [EC2 burstable credits](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-credits-baseline-concepts.html) | Credits are stateful vCPU-time; T3 medium20%, large30% per vCPU. A permanent baseline multiplier is not credit accounting. These are EC2 facts, not validation of RDS values. |
| [EC2 specifications](https://docs.aws.amazon.com/ec2/latest/instancetypes/gp.html), [network bandwidth](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-network-bandwidth.html) | Hardware quantities differ from application throughput; advertised burst and baseline network rates differ and path restrictions apply. Never convert a peak label to a sustained per-edge guarantee. |
| [PostgreSQL18 connections](https://www.postgresql.org/docs/18/runtime-config-connection.html), [resources](https://www.postgresql.org/docs/18/runtime-config-resource.html) | Connections are bounded/reserved configuration. Query memory is per-operation and can multiply under concurrency. No universal connections-per-VM or QPS-per-vCPU follows. |
| [Redis eviction](https://redis.io/docs/latest/develop/reference/eviction/) | maxmemory and eviction policy interact with workload. TTL/key reuse/capacity must be explicit; a global hit percentage is not an external fact. |
| [RabbitMQ acknowledgements](https://www.rabbitmq.com/docs/confirms), [prefetch](https://www.rabbitmq.com/docs/consumer-prefetch) | Accepted, delivered, unacknowledged, requeued and dead-lettered work differ; prefetch bounds in-flight deliveries. Requeue loops consume resources. Model a broker lifecycle, not pass-through RPS. |
| [S3 performance](https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance.html) | Operation- and prefix-specific scaling guidance does not establish a universal object-store capacity. Storage operations, bytes, prefixes and throttling need their own state. |
| [RFC1035](https://www.rfc-editor.org/rfc/rfc1035.html) | DNS queries/caching/TTL are a control-plane request family; forwarding every HTTP request through DNS is not DNS resolution. |
| [RFC9110](https://www.rfc-editor.org/rfc/rfc9110.html), [RFC6298](https://www.rfc-editor.org/rfc/rfc6298.html) | HTTP retry safety and TCP retransmission timing are different layers. Protocol semantics do not determine a universal application timeout. |
| [AWS retry/timeouts](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/) | Timeouts depend on downstream latency and retries can amplify overload. Represent attempt budgets, deadlines, backoff and idempotency; do not add fixed neighbour CPU taxes. |
| [Envoy load balancing](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/load_balancing/load_balancers), [circuit breaking](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/circuit_breaking) | Routing choice, pending requests and connection/request limits are distinct mechanisms. Policy and health detection lag must be authored. M2A round robin is a specific simplified policy. |
| [Kubernetes HPA](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/) | Scaling is a sampled control loop with configured metrics and stabilization. Its documented controller defaults are not universal VM provisioning times. |
| [DigitalOcean billing](https://docs.digitalocean.com/products/droplets/details/pricing/) | Current bundled CPU plans use billing minimums and a672-hour cap. A730-hour generic divisor is an estimate, not provider billing. No live tariff import in M2A. |
| [OpenTelemetry data model](https://opentelemetry.io/docs/specs/otel/metrics/data-model/), [Prometheus instrumentation](https://prometheus.io/docs/practices/instrumentation/) | Distinguish stocks, cumulative counts, time intervals and missing data. Derive metrics from actual mechanism events and retain units/populations. |
| [NIST simulation metamorphic testing](https://www.nist.gov/publications/metamorphic-testing-continuum-verification-and-validation-simulation-models), [V&V/UQ](https://www.nist.gov/publications/summary-industrial-verification-validation-and-uncertainty-quantification-procedures) | Numerical/software verification differs from external model validation. Repeatability, invariants and monotonic cases verify our implementation; without independent benchmarks they do not validate real application performance. |

## Open research and calibration work

M2B needs openly reproducible benchmark traces with workload/application version,
hardware, CPU scheduler policy, distributions, warm-up and measurement error. Decide
when individual jobs versus weighted cohorts are valid, preserving conservation and
tails. Investigate service-demand correlation, burst/session arrivals and demand
changes under contention. Separate epistemic ranges from aleatory distributions;
uniform sampling is not implied by an interval. Model discrepancy remains separate
from both. Fit on one dataset and test held-out configurations; publish validity
domains and errors, not just a fitted coefficient.

Before later slices: characterize link contention and connection lifetimes; DB query
mix/working sets/I/O and locks; cache reuse/TTL/eviction traces; broker delivery and
durability tradeoffs; storage consistency and partitioned throughput; failure-domain
correlation and detection lag; provider tariff effective dates/licensing/rounding.
Security enforcement and identity are not implied by ports or diagram adjacency.
Cross-region, replication and failover need explicit consistency and data-loss models.
