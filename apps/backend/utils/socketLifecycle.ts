import type { WebSocketServer } from "ws";

export const MAX_SOCKET_CLIENTS = 128;

export function startSocketHeartbeat(server: WebSocketServer, intervalMs = 30000) {
  const alive = new WeakMap<object, boolean>();
  server.on("connection", socket => {
    alive.set(socket, true);
    socket.on("pong", () => alive.set(socket, true));
  });
  const timer = setInterval(() => {
    for (const socket of server.clients) {
      if (!alive.get(socket)) { socket.terminate(); continue; }
      alive.set(socket, false);
      try { socket.ping(); } catch { socket.terminate(); }
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
