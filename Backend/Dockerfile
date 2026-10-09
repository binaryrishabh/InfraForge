FROM oven/bun:1.3.14
WORKDIR /app

# Install the full workspace from its single lockfile.
COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY Backend/package.json ./Backend/
COPY Frontend/package.json ./Frontend/
COPY packages/domain/package.json ./packages/domain/
COPY packages/catalog/package.json ./packages/catalog/
RUN bun install --frozen-lockfile

# Preserve the current source paths and exclude existing generated clients.
COPY Backend/index.ts Backend/worker.ts Backend/ws-server.ts Backend/tsconfig.json Backend/prisma.config.ts ./Backend/
COPY Backend/infra ./Backend/infra/
COPY Backend/auth ./Backend/auth/
COPY Backend/deployments ./Backend/deployments/
COPY Backend/scripts ./Backend/scripts/
COPY Backend/lib/prisma.ts ./Backend/lib/
COPY Backend/routes ./Backend/routes/
COPY Backend/simulator ./Backend/simulator/
COPY Backend/stages ./Backend/stages/
COPY Backend/utils ./Backend/utils/
COPY Backend/zod_schemas ./Backend/zod_schemas/
COPY Backend/prisma ./Backend/prisma/
COPY shared ./shared/
COPY packages/domain/src ./packages/domain/src/
COPY packages/catalog/src ./packages/catalog/src/

# Generate after every authored copy so stale local output cannot replace it.
RUN cd Backend && bun --bun run db:generate

CMD ["bun", "run", "Backend/index.ts"]
