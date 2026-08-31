FROM oven/bun:1.3.14
WORKDIR /app

# 1) Manifests first for layer caching
COPY Backend/package.json Backend/bun.lock ./Backend/

# 2) Install dependencies
RUN cd Backend && bun install --frozen-lockfile

# 3) Prisma schema + config, then generate client
COPY Backend/prisma ./Backend/prisma/
COPY Backend/prisma.config.ts ./Backend/
RUN cd Backend && bunx prisma generate

# 4) App source (repo layout preserved so ../shared imports resolve)
COPY shared ./shared/
COPY Backend ./Backend/

CMD ["bun", "run", "Backend/index.ts"]