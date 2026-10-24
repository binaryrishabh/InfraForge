# Oracle ARM64 readiness evidence

Audited 2026-10-24 against main `b0759f9d1186f130f1c87367e7281030180dd148`.
This is public artifact/static evidence. No VM, production secret, native ARM
runtime, Docker integration runner or Linux proof container was accessed/run.
Native release, reboot, backup/restore and comparable load remain deployment gates.

## Container images

Fetched Docker Hub Registry v2 indexes by the exact source digest using anonymous
pull authorization. SHA256 of each raw index matched the requested digest. Read
its linux/arm64 child manifest and configuration; every child config says
`os=linux`, `architecture=arm64`. The same indexes also contain linux/amd64.
Registry links below are public endpoints (anonymous registry token required).

| Image and source | Index SHA256 | ARM64 child SHA256 |
| --- | --- | --- |
| `oven/bun` — apps/backend/Dockerfile:1; ops/bootstrap/Dockerfile.fixture:1 | [`sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4`](https://registry-1.docker.io/v2/oven/bun/manifests/sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4) | `sha256:d8a4c24744b290bf789d58966a6f2521fc4d8bec36ec02cead6c541147b7d550` |
| `library/postgres` — apps/backend/docker-compose.yml:53 | [`sha256:898c60cb390d1085bc97bdd6a1ae968757421df394b071848b52b1c09c89d6a5`](https://registry-1.docker.io/v2/library/postgres/manifests/sha256:898c60cb390d1085bc97bdd6a1ae968757421df394b071848b52b1c09c89d6a5) | `sha256:b1c1673a890fba8fae71d37210b4fd9a0b5cd0df8bb994a6bcc01d9cf8e1670c` |
| `library/redis` — apps/backend/docker-compose.yml:95 | [`sha256:57e4255cc971b1c8d6f8a6ca283ac01bc3ecdd914273ef6bfaede87aaecd6541`](https://registry-1.docker.io/v2/library/redis/manifests/sha256:57e4255cc971b1c8d6f8a6ca283ac01bc3ecdd914273ef6bfaede87aaecd6541) | `sha256:12bd99f4555ce357cbe0c950ad42c7a86f76e807244995f0ad0a6b8949c3518a` |
| `moby/buildkit` — scripts/release/build.ts:16 (implicit mutable default) | [`sha256:cec9f139f45e93c5c69c60f8b07cfad9f43f4ef6b6a6cd917527fea5ff2e3dea`](https://registry-1.docker.io/v2/moby/buildkit/manifests/sha256:cec9f139f45e93c5c69c60f8b07cfad9f43f4ef6b6a6cd917527fea5ff2e3dea) | `sha256:3ad6bb9bc8c78c0069d03247adb9a59b3b43d68e55353e876e558b888c6c1768` |
| `library/ubuntu` — ops/bootstrap/Dockerfile.fixture:2 | [`sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac`](https://registry-1.docker.io/v2/library/ubuntu/manifests/sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac) | `sha256:18b33ff3829707f31ada654a963b9ee35f2e6f0241b964bd17a22a9b330cb63d` |
| `library/alpine` — scripts/release/rehearse.ts:244 (fixture only) | [`sha256:2e0b81d60597f449baa56dc25d355367869d2dca4cd57e866f1e2b52af3eb55f`](https://registry-1.docker.io/v2/library/alpine/manifests/sha256:2e0b81d60597f449baa56dc25d355367869d2dca4cd57e866f1e2b52af3eb55f) | `sha256:3e07a4f627d12468155eb812785e10f2453a447c346872b47788a62437366764` |

Production Bun is `1.3.14`, PostgreSQL `18-alpine`, Redis `7-alpine`. The application
image is built natively from that Bun index; API/WS/worker/migration share it
(`apps/backend/docker-compose.yml:1`). No `platform: linux/amd64` override exists.
Do not copy x86 Docker images or generated Prisma output to A1. Docker's Ubuntu
installer [supports arm64 on Ubuntu 24.04](https://docs.docker.com/engine/install/ubuntu/).

**Builder overlap / lead gate:** `scripts/release/build.ts:16-17` supplies
`docker-container` resource limits but no `image=` driver option. Buildx's
[default image constant](https://github.com/docker/buildx/blob/master/driver/bkimage/bkimage.go)
is `moby/buildkit:buildx-stable-1`. The table records its index at audit time;
**the repository does not pin that index**, so a pinned-builder assertion cannot
honestly pass. Coordinate the minimal index pin and its negative regression test
with w50 before declaring all release inputs pinned. Reaudit its merged digest.
No release code was edited here; CPU/memory/swap checks are unchanged. The current
default has ARM64 support, so this is reproducibility debt, not evidence of an
x86-only builder. No emulation or QEMU is required for a native A1 build.

The bootstrap backup proof uses mutable `postgres:18`
(`ops/bootstrap/prove-backup.sh:15-16`), and the scratch restore example does too
(`docs/SELF_HOSTED_POSTGRES.md`). Neither is the production database pin. Refresh
and record those exact image indexes before any separately authorized scratch
drill; do not call those fixtures pinned. This task did not execute them.

## Native dependency inventory

The Dockerfile installs the **whole workspace**, including web build dependencies
(`apps/backend/Dockerfile:9-17`), so auditing only backend direct dependencies is
insufficient. Scanned all platform-constrained records in `bun.lock`. Downloaded
all **10 linux/arm64 package tarballs**, matched each npm metadata integrity and
the tarball's calculated SHA512 to the lockfile, and inspected ELF headers without
executing them. Every binary listed below is ELF64 little-endian `EM_AARCH64=183`.
The GNU/musl variants are distinct, not interchangeable.

| Locked family | AArch64 artifact evidence | Lockfile source |
| --- | --- | --- |
| msgpackr-extract 3.0.4 | [`@msgpackr-extract/msgpackr-extract-linux-arm64`](https://registry.npmjs.org/@msgpackr-extract%2fmsgpackr-extract-linux-arm64/3.0.4): `node.abi115.musl.node`, `node.napi.musl.node` | `bun.lock:308`, `bun.lock:938` |
| Rolldown 1.2.2 | [`binding-linux-arm64-gnu`](https://registry.npmjs.org/@rolldown%2fbinding-linux-arm64-gnu/1.2.2) and [`musl`](https://registry.npmjs.org/@rolldown%2fbinding-linux-arm64-musl/1.2.2), `.node` files | `bun.lock:404`, `bun.lock:406`, `bun.lock:1072` |
| Tailwind oxide 4.3.3 | [`oxide-linux-arm64-gnu`](https://registry.npmjs.org/@tailwindcss%2foxide-linux-arm64-gnu/4.3.3) and [`musl`](https://registry.npmjs.org/@tailwindcss%2foxide-linux-arm64-musl/4.3.3), `.node` files | `bun.lock:428`, `bun.lock:440`, `bun.lock:442` |
| Lightning CSS 1.33.0 | [`linux-arm64-gnu`](https://registry.npmjs.org/lightningcss-linux-arm64-gnu/1.33.0) and [`musl`](https://registry.npmjs.org/lightningcss-linux-arm64-musl/1.33.0), `.node` files | `bun.lock:882`, `bun.lock:894`, `bun.lock:896` |
| Nested Lightning CSS 1.32.0 | [`linux-arm64-gnu`](https://registry.npmjs.org/lightningcss-linux-arm64-gnu/1.32.0) and [`musl`](https://registry.npmjs.org/lightningcss-linux-arm64-musl/1.32.0), `.node` files | `bun.lock:1220`, `bun.lock:1274`, `bun.lock:1276` |
| Turbo 2.11.6 | [`@turbo/linux-arm64`](https://registry.npmjs.org/@turbo%2flinux-arm64/2.11.6), `turbo-linux-arm64/bin/turbo` | `bun.lock:462`, `bun.lock:1136` |

**msgpackr qualification:** its published ARM64 optional package contains **musl
builds only**. The Bun application image is glibc-based; the installed
`node-gyp-build-optional-packages@5.2.2` loader rejects a musl-tagged prebuild on
glibc. The integrity-verified `msgpackr@2.0.5` `node-index.js` catches an unavailable
extractor and uses the JavaScript implementation. This is upstream's optional
optimization, not an application guard to bypass. Thus ARM64 package existence
**does not prove native acceleration on this image**. Do not force `LIBC=musl`,
copy a binary across libc/architecture, or weaken checks. The migration smoke tests
round-trip Unicode/binary payloads and records `isNativeAccelerationEnabled`;
representative BullMQ load must pass on the actual image before acceptance. If
measured performance fails, review a dependency release that includes a compatible
N-API glibc ARM64 prebuild; no speculative dependency update is made here.

Other binary/platform families: `fsevents@2.3.3` is Darwin-only and optional
(`bun.lock:792`, `bun.lock:1162`); it is skipped on Linux. `bufferutil` and
`utf-8-validate` are **uninstalled optional peers** of ws (`bun.lock:1170`), and
`better-sqlite3` is an uninstalled optional peer of Prisma (`bun.lock:1022`),
not missing required A1 modules. WebAssembly assets are architecture-neutral;
Tailwind's WASI fallback is present (`bun.lock:448`). No locked esbuild/sharp/SWC
native package was found. This conclusion is scoped to this lockfile, not future
optional package additions.

## Prisma CLI and runtime

`@prisma/engines@7.9.1` pins engine commit
`e922089b7d7502aff4249d5da3420f6fa55fc6ad` (`bun.lock:336-340`). Verified the exact
[ARM64/OpenSSL 3 schema-engine archive](https://binaries.prisma.sh/all_commits/e922089b7d7502aff4249d5da3420f6fa55fc6ad/linux-arm64-openssl-3.0.x/schema-engine.gz)
and its [compressed checksum](https://binaries.prisma.sh/all_commits/e922089b7d7502aff4249d5da3420f6fa55fc6ad/linux-arm64-openssl-3.0.x/schema-engine.gz.sha256)
and [uncompressed checksum](https://binaries.prisma.sh/all_commits/e922089b7d7502aff4249d5da3420f6fa55fc6ad/linux-arm64-openssl-3.0.x/schema-engine.sha256):

- Compressed SHA256: `5993c9cb40ad3316e11ee10b6691e147719fd01287c4fd7a24045751e5d2a770`.
- Uncompressed SHA256: `d9a989479930b10d81b7e2bd8027723ca455189f402d4323ed452ae3a7a793cf`.
- ELF header: 64-bit little-endian, AArch64 (`e_machine=183`).

An initial generic HTTP request returned 403; retry with Prisma's User-Agent
succeeded. Artifact contents/checksums, not that initial error, support this result.
[Prisma's ARM target table](https://www.prisma.io/docs/orm/v7/reference/prisma-schema-reference)
also identifies `linux-arm64-openssl-3.0.x`. `prisma-client` generation
(`apps/backend/prisma/schema.prisma:1-4`) happens **inside the native image**
(`apps/backend/Dockerfile:61`). Runtime uses the JavaScript PostgreSQL adapter
(`apps/backend/lib/prisma.ts:2-15`), not an x86 Rust query engine copied from this
Windows workspace. Schema-engine migrate/status/diff still require the native
CLI engine. Check `prisma -v` in the actual image and retain all migration/session,
schema/history/identity checks. No blanket `binaryTargets` override is needed.

## Bootstrap

`ops/bootstrap/host.sh:27` selects Docker apt architecture using
`dpkg --print-architecture`; `:47-55` explicitly maps `aarch64` to
`bun-linux-aarch64` and validates its pinned archive SHA256
`a27ffb63a8310375836e0d6f668ae17fa8d8d18b88c37c821c65331973a19a3b`.
Compared both x64 and aarch64 constants to the official
[Bun 1.3.14 checksum list](https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/SHASUMS256.txt).
Ubuntu version, checksum and unsupported-architecture refusals stay intact.
Other bootstrap layout/Nginx/backup scripts use architecture-neutral shell/tools;
PostgreSQL 18 host backup clients and any w48 cloud client must also be installed
for ARM64 (never copy an x86 AWS CLI executable). The new-host firewall, UTC/NTP
and no-additional-swap decision are in [production bootstrap](../PRODUCTION_BOOTSTRAP.md#oracle-a1-network-firewall-clock-and-swap).

## Acceptance boundary

No mandatory x86-only input was found in this checkout. No executable source,
lockfile, Dockerfile, Compose or identity-tracked file needed changing for ARM.
Native loading/CLI behavior, actual resource enforcement, release duration,
throughput, OAuth/WS, OCI firewall/reboot and offsite recovery remain **unverified**.
The owner/lead must record those results using [the migration runbook](../ORACLE_MIGRATION.md).
A1 is a readiness candidate, not a claim of deployed performance parity.
