import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { QuestionStore } from './question-store.js';
import { RoomManager } from './rooms.js';
import { registerSocketHandlers } from './socket.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.resolve(__dirname, '../client');

/**
 * Obtiene la primera IPv4 LAN no interna para que los códigos QR funcionen desde móviles en la misma red Wi-Fi.
 */
export function getLocalLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

/**
 * Crea la instancia de servidor Express + Socket.IO (exportada para tests de integración).
 */
export function createQuizonServer({ port = process.env.PORT || 3000, questionsPath } = {}) {
  const app = express();
  const httpServer = http.createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: { origin: '*' },
  });

  const questionStore = new QuestionStore(questionsPath);
  const roomManager = new RoomManager();
  let actualPort = port;

  const getBaseUrl = () => {
    if (process.env.PUBLIC_URL) {
      return process.env.PUBLIC_URL.replace(/\/+$/, '');
    }
    const ip = getLocalLanIp();
    return `http://${ip}:${actualPort}`;
  };

  app.use(express.static(CLIENT_DIR));

  app.get('/tv', (_req, res) => res.sendFile(path.join(CLIENT_DIR, 'tv.html')));
  app.get('/player', (_req, res) => res.sendFile(path.join(CLIENT_DIR, 'player.html')));
  app.get('/host', (_req, res) => res.sendFile(path.join(CLIENT_DIR, 'host.html')));

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      rooms: roomManager.rooms.size,
      packs: questionStore.packs.length,
    });
  });

  app.get('/api/packs', (_req, res) => {
    res.json({ packs: questionStore.getPacksSummary() });
  });

  registerSocketHandlers(io, roomManager, questionStore, getBaseUrl);

  return {
    app,
    httpServer,
    io,
    roomManager,
    questionStore,
    start() {
      return new Promise((resolve) => {
        httpServer.listen(port, '0.0.0.0', () => {
          const addr = httpServer.address();
          actualPort = typeof addr === 'object' && addr ? addr.port : port;
          resolve({ port: actualPort, lanUrl: getBaseUrl() });
        });
      });
    },
    stop() {
      return new Promise((resolve) => {
        io.close(() => {
          httpServer.close(() => resolve());
        });
      });
    },
  };
}

// Arranque directo si se ejecuta como script principal
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const server = createQuizonServer();
  server.start().then(({ port, lanUrl }) => {
    console.log(`QUIZÓN servidor activo en:`);
    console.log(`  Local: http://localhost:${port}`);
    console.log(`  Red:   ${lanUrl}`);
    console.log(`  TV:    ${lanUrl}/tv`);
  });
}

