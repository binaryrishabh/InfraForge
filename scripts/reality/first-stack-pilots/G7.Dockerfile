FROM oven/bun@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS runtime
FROM valkey/valkey@sha256:fea8b3e67b15729d4bb70589eb03367bab9ad1ee89c876f54327fc7c6e618571
COPY --from=runtime /usr/local/bin/bun /usr/local/bin/bun
USER root
ENTRYPOINT ["bun", "--no-env-file", "/harness/g7-probe.ts"]
