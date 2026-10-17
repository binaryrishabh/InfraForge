# syntax=docker/dockerfile:1.14
FROM oven/bun:1.3.14
RUN command -v timeout
ARG RELEASE_SHA
LABEL org.opencontainers.image.source="https://github.com/binaryrishabh/InfraForge" \
      org.opencontainers.image.revision=$RELEASE_SHA
WORKDIR /app

# Install the full workspace from its single lockfile.
COPY --chmod=u=rwX,go=rX package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY --chmod=u=rwX,go=rX apps/backend/package.json ./apps/backend/
COPY --chmod=u=rwX,go=rX apps/web/package.json ./apps/web/
COPY --chmod=u=rwX,go=rX packages/domain/package.json ./packages/domain/
COPY --chmod=u=rwX,go=rX packages/catalog/package.json ./packages/catalog/
COPY --chmod=u=rwX,go=rX packages/contracts/package.json ./packages/contracts/
COPY --chmod=u=rwX,go=rX packages/simulation/package.json ./packages/simulation/
RUN bun install --frozen-lockfile

# Copy authored source; generate the client inside the image.
COPY --chmod=u=rwX,go=rX apps/backend/index.ts apps/backend/worker.ts apps/backend/ws-server.ts apps/backend/tsconfig.json apps/backend/prisma.config.ts ./apps/backend/
COPY --chmod=u=rwX,go=rX apps/backend/infra ./apps/backend/infra/
COPY --chmod=u=rwX,go=rX apps/backend/auth ./apps/backend/auth/
COPY --chmod=u=rwX,go=rX apps/backend/health ./apps/backend/health/
COPY --chmod=u=rwX,go=rX apps/backend/release ./apps/backend/release/
COPY --chmod=u=rwX,go=rX apps/backend/cutover ./apps/backend/cutover/
COPY --chmod=u=rwX,go=rX apps/backend/deployments ./apps/backend/deployments/
COPY --chmod=u=rwX,go=rX apps/backend/reports ./apps/backend/reports/
COPY --chmod=u=rwX,go=rX apps/backend/evidence ./apps/backend/evidence/
COPY --chmod=u=rwX,go=rX apps/backend/internalModel2 ./apps/backend/internalModel2/
COPY --chmod=u=rwX,go=rX apps/backend/comparison ./apps/backend/comparison/
COPY --chmod=u=rwX,go=rX apps/backend/reruns ./apps/backend/reruns/
COPY --chmod=u=rwX,go=rX apps/backend/actions ./apps/backend/actions/
COPY --chmod=u=rwX,go=rX apps/backend/challenges ./apps/backend/challenges/
COPY --chmod=u=rwX,go=rX apps/backend/scripts ./apps/backend/scripts/
COPY --chmod=u=rwX,go=rX apps/backend/lib/prisma.ts ./apps/backend/lib/
COPY --chmod=u=rwX,go=rX apps/backend/routes ./apps/backend/routes/
COPY --chmod=u=rwX,go=rX apps/backend/simulator ./apps/backend/simulator/
COPY --chmod=u=rwX,go=rX apps/backend/stages ./apps/backend/stages/
COPY --chmod=u=rwX,go=rX apps/backend/utils ./apps/backend/utils/
COPY --chmod=u=rwX,go=rX apps/backend/zod_schemas ./apps/backend/zod_schemas/
COPY --chmod=u=rwX,go=rX apps/backend/types ./apps/backend/types/
COPY --chmod=u=rwX,go=rX apps/backend/prisma ./apps/backend/prisma/
COPY --chmod=u=rwX,go=rX packages/domain/src ./packages/domain/src/
COPY --chmod=u=rwX,go=rX packages/catalog/src ./packages/catalog/src/
COPY --chmod=u=rwX,go=rX packages/contracts/src ./packages/contracts/src/
COPY --chmod=u=rwX,go=rX packages/simulation/src ./packages/simulation/src/

# Generate after every authored copy so stale local output cannot replace it.
RUN cd apps/backend && bun --bun run db:generate
RUN cd apps/backend && bun --no-env-file release/cli.ts manifest "$RELEASE_SHA" > release.json
USER bun

CMD ["bun", "run", "apps/backend/index.ts"]
