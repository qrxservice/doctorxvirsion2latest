import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

interface QueueClient {
  ws: WebSocket;
  doctorId: number;
}

const clients = new Set<QueueClient>();
const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws: WebSocket) => {
  const client: QueueClient = { ws, doctorId: 0 };
  clients.add(client);

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as unknown;
      if (
        msg !== null &&
        typeof msg === "object" &&
        "type" in msg &&
        (msg as Record<string, unknown>)["type"] === "subscribe" &&
        "doctorId" in msg &&
        typeof (msg as Record<string, unknown>)["doctorId"] === "number"
      ) {
        client.doctorId = (msg as Record<string, unknown>)["doctorId"] as number;
      }
    } catch {
    }
  });

  ws.on("close", () => {
    clients.delete(client);
  });

  ws.on("error", () => {
    clients.delete(client);
  });
});

export function broadcastQueueUpdate(doctorId: number, socketEvent = "queue:updated"): void {
  const payload = JSON.stringify({ type: "queue-update", doctorId });
  for (const client of clients) {
    if (
      client.ws.readyState === WebSocket.OPEN &&
      (client.doctorId === doctorId || client.doctorId === 0)
    ) {
      client.ws.send(payload);
    }
  }
  // Also broadcast to Socket.IO display screens (import deferred to avoid
  // circular init — socketManager may not be initialized yet at module load).
  import("./socketManager").then(({ broadcastSocketEvent }) => {
    broadcastSocketEvent(doctorId, socketEvent);
  }).catch(() => { /* non-fatal: Socket.IO not yet ready */ });
}

export function handleWsUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): boolean {
  if (req.url === "/api/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
    return true;
  }
  return false;
}
