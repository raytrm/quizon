/**
 * Wrapper ligero sobre Socket.IO para gestionar conexión y reconexión.
 */
export function createSocketConnection() {
  if (typeof window.io !== 'function') {
    throw new Error('Socket.IO client no cargado.');
  }
  const socket = window.io({
    reconnection: true,
    reconnectionDelay: 800,
    reconnectionDelayMax: 4000,
  });
  return socket;
}

