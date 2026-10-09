FROM oven/bun:1.3.14
ARG RELEASE_SHA
LABEL org.opencontainers.image.source="https://github.com/binaryrishabh/InfraForge" \
      org.opencontainers.image.revision=$RELEASE_SHA
WORKDIR /app

# Install the full workspace from its single lockfile.
COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/web/package.json ./apps/web/
COPY packages/domain/package.json ./packages/domain/
COPY packages/catalog/package.json ./packages/catalog/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/simulation/package.json ./packages/simulation/
RUN bun install --frozen-lockfile

# Copy authored source; generate the client inside the image.
COPY apps/backend/index.ts apps/backend/worker.ts apps/backend/ws-server.ts apps/backend/tsconfig.json apps/backend/prisma.config.ts ./apps/backend/
COPY apps/backend/infra ./apps/backend/infra/
COPY apps/backend/auth ./apps/backend/auth/
COPY apps/backend/health ./apps/backend/health/
COPY apps/backend/release ./apps/backend/release/
COPY apps/backend/deployments ./apps/backend/deployments/
COPY apps/backend/scripts ./apps/backend/scripts/
COPY apps/backend/lib/prisma.ts ./apps/backend/lib/
COPY apps/backend/routes ./apps/backend/routes/
COPY apps/backend/simulator ./apps/backend/simulator/
COPY apps/backend/stages ./apps/backend/stages/
COPY apps/backend/utils ./apps/backend/utils/
COPY apps/backend/zod_schemas ./apps/backend/zod_schemas/
COPY apps/backend/types ./apps/backend/types/
COPY apps/backend/prisma ./apps/backend/prisma/
COPY packages/domain/src ./packages/domain/src/
COPY packages/catalog/src ./packages/catalog/src/
COPY packages/contracts/src ./packages/contracts/src/
COPY packages/simulation/src ./packages/simulation/src/

# Generate after every authored copy so stale local output cannot replace it.
RUN cd apps/backend && bun --bun run db:generate
RUN cd apps/backend && bun --no-env-file release/cli.ts manifest "$RELEASE_SHA" > release.json
USER bun

CMD ["bun", "run", "apps/backend/index.ts"]
