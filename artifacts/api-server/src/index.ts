import http from "node:http";
import app, { allowedOrigins } from "./app";
import { logger } from "./lib/logger";
import { seedDefaultUsers } from "./lib/seed";
import { handleWsUpgrade } from "./lib/wsManager";
import { initSocketIO } from "./lib/socketManager";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);

// Socket.IO for real-time display screens (TVs, kiosks, mobile)
initSocketIO(server, allowedOrigins);

server.on("upgrade", (req, socket, head) => {
  if (!handleWsUpgrade(req, socket, head)) {
    socket.destroy();
  }
});

server.listen(port, () => {
  logger.info({ port }, "Server listening");

  seedDefaultUsers().catch((err: unknown) => {
    logger.warn({ err }, "Background seed failed (non-fatal)");
  });
});
