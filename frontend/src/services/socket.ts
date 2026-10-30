/**
 * Shared Socket.IO client. Connects to the backend (uses VITE_API_URL host).
 * Reconnects automatically. Used for live attendance updates.
 */
import { io, Socket } from 'socket.io-client';

const apiUrl = import.meta.env.VITE_API_URL || '/api';
// Strip "/api" suffix to get the server origin
const serverOrigin = apiUrl.replace(/\/api\/?$/, '') || window.location.origin;

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(serverOrigin, {
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      transports: ['websocket', 'polling'],
    });
    socket.on('connect', () => console.log('[Socket] Connected', socket?.id));
    socket.on('disconnect', (r) => console.log('[Socket] Disconnected', r));
    socket.on('connect_error', (e) => console.warn('[Socket] connect_error', e.message));
  }
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
