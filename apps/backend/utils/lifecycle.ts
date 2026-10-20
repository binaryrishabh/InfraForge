import type { Server } from "node:http";

export function configureHttpServer(server: Server) {
  server.headersTimeout = 10000;
  server.requestTimeout = 30000;
  server.keepAliveTimeout = 5000;
  server.setTimeout(30000, socket => socket.destroy());
}

export function createShutdown(server: Server, cleanup: () => Promise<void>, options: {
  stopIngress?: () => void; deadlineMs?: number; exit?: (code: number) => void;
} = {}) {
  const exit = options.exit ?? (code => process.exit(code));
  let pending: Promise<void> | undefined;
  let stopping = false;
  const shutdown = () => {
    if (pending) return pending;
    stopping = true;
    pending = (async () => {
      let expired = false;
      const deadline = setTimeout(() => {
        expired = true;
        server.closeAllConnections();
        exit(1);
      }, options.deadlineMs ?? 25000);
      try {
        options.stopIngress?.();
        await new Promise<void>((resolve, reject) => {
          server.close(error => error ? reject(error) : resolve());
          server.closeIdleConnections();
        });
        await cleanup();
        if (!expired) exit(0);
      } catch {
        console.error("Shutdown failed; process must restart before serving traffic.");
        if (!expired) exit(1);
      } finally { clearTimeout(deadline); }
    })();
    return pending;
  };
  return { shutdown, isStopping: () => stopping };
}

export function shutdownOnSignals(lifecycle: ReturnType<typeof createShutdown>) {
  process.once("SIGTERM", () => { void lifecycle.shutdown(); });
  process.once("SIGINT", () => { void lifecycle.shutdown(); });
}
