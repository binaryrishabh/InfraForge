# M2F measurements and calibration boundary

`measure:async` explicitly launches one uniquely labelled disposable local RabbitMQ
container with loopback-only management port, one CPU quota and tmpfs state. It
also starts a loopback-only Node current-object reference server. It uses no normal
developer service, hosted system, production credentials or environment file.
Ownership labels are verified before removing the broker. HTTP agents/connections
and reference state are closed in finally. Both campaign attempts cleaned their
fixtures; the first rejected a queue declaration before measurements, and the final
run records complete cleanup with no errors.

The final campaign uses RabbitMQ **4.3.6** through its **HTTP management API**, not
AMQP. Queue metadata is durable, messages are transient and storage is tmpfs; no
physical durability measurement is claimed. The object reference is an independently
written Node HTTP Map with real bounded byte payloads and atomic end-of-upload
replacement. It is not S3, a cloud service or a physical storage benchmark.

Raw observations retain source/image/environment hashes, host/Node versions,
per-operation latency, body byte counts, logical message identity, reuse flags,
container CPU deltas and combined Node process CPU. The host is Windows/Ryzen 7
5700U with Node v24.15.0. Ordered batches, background activity, HTTP management
overhead, VM scheduling, client costs and GC are explicit limitations.

## Broker campaign

54 batches × 32 operations = **1,728 measured operations**. Message sizes
64/4,096/65,536 bytes, closed client concurrency 1/4/8, publish/consume and three
repetitions. Consume batches are preloaded outside the measurement interval;
publish batches are drained afterwards and population identities checked.
HTTP get performs immediate ack/requeue actions, so this campaign does not identify
consumer prefetch, connection-crash recovery or visibility-lease behavior.

Fit: sizes 64/65,536, concurrency 1/8, repetitions 0/1 → **16 batches**, eight
discrete aggregate-CPU candidates. Holdout: size 4,096 or concurrency 4, plus third
repetitions → **38 batches**, including 30 wholly held-out configurations. Only
fitting container CPU deltas form candidates; background/monitoring overhead remains
included. Unseen size/concurrency transfer is explicitly unsupported diagnostic.
The actual broker command module replays finite publish/receive populations through
M2C CPU; management consume's immediate ack is not silently equated with a lease.

| Split | Batches | Throughput MARE | Response MAE |
| --- | ---: | ---: | ---: |
| Fit | 16 | 21.98% | 13,834.85 µs |
| Holdout | 38 | 22.99% | 13,138.79 µs |

**The complete timing predictor is REJECTED.** Errors remain visible, aggregate CPU
does not identify command service, and the measured HTTP protocol is not the generic
queue profile. No network/latency correction or universal throughput constant is
fitted. These finite errors are not confidence bounds or a provider validity claim.

## Object campaign

108 batches × 32 operations = **3,456 measured operations**. Object sizes
64/4,096/65,536 bytes, closed concurrency 1/4/8, PUT/GET, persistent reuse on/off,
three repetitions. Fit has **32 batches**, holdout **76** using the same unseen
size/concurrency and repetition split. Stored object populations and GET body bytes
replay exactly in all 108 cases. Real GET buffers were checked against the uploaded
payload; the simulator replays size/content identity without copying payloads.

Process CPU combines the reference server and benchmark client. **Six batches have
zero CPU deltas** at the local timer resolution. They do not prove zero CPU demand.
No object timing model is fitted; command CPU, device timing and transport/runtime
decomposition remain **Unknown**. The replay's one-microsecond CPU clock and zero
injected blocking are synthetic semantic-test inputs, never calibrated physics.

Independent semantic observations verify a requeued message retains ID and returns
with redelivery set, ack removes it, object replacement yields complete old/new
bytes, exactly one of two conditional creators succeeds (200/412), and DELETE
produces a later 404. They do not validate provider durability or queue lease timing.

Source/split/operation identity/byte/cleanup checks guard replay. Tests perturb
only held-out timing and prove fitted candidates cannot change; split/source/byte
drift fails closed. M2D and M2E complete timing predictors stay rejected. All new
candidates and synthetic values are forbidden from Free Mode; no SQS/Kafka/S3/R2/
GCS/Azure/RabbitMQ-cloud/SKU mapping is made.
