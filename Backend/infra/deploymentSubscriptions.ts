import WebSocket from "ws";
import * as z from "zod";
import { WebSocketMessage } from "@shared/enum/WebSocketMessage.enum";

interface Subscriber {
  quit: () => Promise<unknown>;
}

type Subscribe = (id: string, receive: (event: unknown) => void, signal: AbortSignal) => Promise<Subscriber>;

export const SUBSCRIPTION_MAX_BYTES = 1024;

const SubscriptionSchema = z.object({
  type: z.literal(WebSocketMessage.Subscribe),
  deploymentId: z.string().uuid(),
});

export function attachDeploymentSubscription(socket: WebSocket, subscribe: Subscribe) {
  const lifetime = new AbortController();
  let desiredId: string | undefined;
  let currentId: string | undefined;
  let subscriber: Subscriber | undefined;
  let subscribing = false;

  const quit = async (connection: Subscriber) => {
    try { await connection.quit(); }
    catch (error) { console.error("Deployment subscription cleanup failed", error); }
  };

  const synchronize = async () => {
    if (subscribing) return;
    subscribing = true;
    try {
      while (!lifetime.signal.aborted && desiredId !== currentId) {
        const requestedId = desiredId!;
        const previous = subscriber;
        subscriber = undefined;
        currentId = undefined;
        if (previous) await quit(previous);
        if (lifetime.signal.aborted) break;
        const connection = await subscribe(requestedId, (event) => {
          if (!lifetime.signal.aborted && desiredId === requestedId && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(event));
          }
        }, lifetime.signal);
        if (lifetime.signal.aborted || desiredId !== requestedId) {
          await quit(connection);
        } else {
          subscriber = connection;
          currentId = requestedId;
        }
      }
    } catch (error) {
      desiredId = currentId;
      if (!lifetime.signal.aborted) {
        console.error("Deployment subscription failed", error);
        socket.close(1011, "Deployment subscription failed");
      }
    } finally { subscribing = false; }
  };

  socket.on("message", (data) => {
    if (lifetime.signal.aborted || socket.readyState !== WebSocket.OPEN) return;
    // Bun's ws compatibility layer does not enforce the server's maxPayload option.
    const bytes = Array.isArray(data)
      ? data.reduce((total, chunk) => total + chunk.byteLength, 0)
      : data.byteLength;
    if (bytes > SUBSCRIPTION_MAX_BYTES) {
      socket.close(1009, "Subscription message is too large");
      return;
    }
    let message: z.infer<typeof SubscriptionSchema>;
    try { message = SubscriptionSchema.parse(JSON.parse(data.toString())); }
    catch { return; }
    desiredId = message.deploymentId;
    void synchronize();
  });

  socket.on("close", () => {
    lifetime.abort();
    if (subscriber) void quit(subscriber);
    subscriber = undefined;
  });
  socket.on("error", () => socket.close());
}
