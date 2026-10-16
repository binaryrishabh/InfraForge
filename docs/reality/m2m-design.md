# M2M bounded first-user decision

The first candidate experience is **Read a current object before, during or after
a modeled process restart**. This uses the existing M2K VM/current-object engine,
owned saved designs, immutable inputs, Outbox, durable captures and replay. It
does not claim to model a cloud provider, application dependency traffic, physical
durability, real outage timing or prices. A versioned, explicitly authored teaching
profile exposes one meaningful choice (read phase); all engineering quantities and
their educational origin remain inspectable before consent. A fresh lesson design
can be explicitly created without trimming an existing unsupported design.

Less-trusted preview grants are scoped to this lesson. They cannot call the raw
authoring/admission path or replay arbitrary advanced inputs. Existing operator
grants retain their accepted internal engineering path. No grants are public or
created by the UI, and no general Model-2 activation is performed.

## Research and safety decision

The current executor runs synchronously in the shared long-lived worker. Logical
event/input/evidence caps cannot stop a blocked event loop or native allocation.
[Node's worker documentation](https://nodejs.org/api/worker_threads.html) explicitly
limits resourceLimits to the JS engine and warns that global OOM can still abort
the process. A thread or JavaScript timeout alone is insufficient for this preview.
[Linux resource limits](https://man7.org/linux/man-pages/man2/getrlimit.2.html)
distinguish CPU time from address space; neither is a complete memory/whole-run wall
clock boundary for a multithreaded runtime.

Use one disposable, immutable-image Linux container per lesson execution or replay,
with hard memory/swap, CPU, PID and file-descriptor limits; a container-internal
wall timeout independent of the parent; no network, credentials, host mounts or
capabilities; read-only root; and bounded input/output with capture/commit ACKs.
The child is trusted shipped engine code accepting JSON, never user-supplied code.
Only validated captures committed under the existing worker ownership token are
acknowledged. Death, cancellation, authorization loss and malformed/oversized
output retain the last committed prefix; no continuation or inline fallback occurs.

[Docker resource constraints](https://docs.docker.com/engine/containers/resource_constraints/)
document that containers are unbounded by default and distinguish hard memory
limits from soft CPU shares. Inspect actual enforced configuration before starting.
[Docker security](https://docs.docker.com/engine/security/) warns that control of the
daemon is privileged. This adapter is disabled unless an operator pins an installed
image ID and provisions a trusted runner host; it never mounts the Docker socket
into an executor or changes the existing production Compose configuration to expose
one. A dedicated [rootless daemon](https://docs.docker.com/engine/security/rootless/)
with verified cgroup delegation is the recommended activation prerequisite, not a
claim that containers eliminate all kernel/runtime risks. No production rollout is
authorized here. Actual OS enforcement, interruption, ownership, persistence,
authorization, replay and complete browser behavior must be proved in disposable CI.

The independent wall guard uses the shipped GNU `timeout`, with a KILL signal
and no foreground exception. Its [manual](https://www.gnu.org/software/coreutils/manual/html_node/timeout-invocation.html)
distinguishes timeout/signaled exits; exit 137 alone does not distinguish CPU,
OOM or wall termination. Tests retain configured limits, actual cgroup/rlimit
values, Docker OOM state, elapsed time and the deliberately exercised failure.
Rootless [cgroup limitations](https://docs.docker.com/engine/security/rootless/troubleshoot/)
must be checked on the actual runner: a configured CLI flag is not proof that
delegation worked. The ready handshake refuses missing or unenforced cgroup v2
limits. Test-only replacement entrypoints exercise real exhaustion without adding
an application failure switch or accepting user executable code.

## Acceptance boundary

Preserve all accepted M2K/M2L evidence and core execution identities. Add explicit
source lineage to reconstruct the accepted M2L workspace rather than relabel old
proofs after product changes. Keep 474 accepted inventory entries unchanged where
their controls are unchanged; changed/new controls require actual semantic review
and proof. Technical shipping, physical validity and general activation stay closed.
Claude can replace lesson layout/styles; versioned profile, scopes, exact review /
retry identity, actual result semantics and execution limits are behavior contracts.
