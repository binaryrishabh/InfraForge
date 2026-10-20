import type { WebSocketServer } from "ws";

export const MAX_SOCKET_CLIENTS = 128;

export function startSocketHeartbeat(server: WebSocketServer, intervalMs = 30000) {
  const alive = new WeakSet<object>();
  server.on("connection", socket => {
    alive.add(socket);
    socket.on("pong", () => alive.add(socket));
  });
  const timer = setInterval(() => {
    for (const socket of server.clients) {
      if (!alive.has(socket)) { socket.terminate(); continue; }
      alive.delete(socket);
      try { socket.ping(); } catch { socket.terminate(); }
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
