import 'dotenv/config';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import app from './app';
import { startCronJobs } from './services/cronService';
import { fixHalfDayRecords } from './services/esslService';

const PORT = process.env.PORT || 5000;

const httpServer = http.createServer(app);

export const io = new SocketIOServer(httpServer, {
  cors: {
    origin: true,
    credentials: true,
  },
});

io.on('connection', (socket) => {
  console.log(`[Socket.io] Client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`[Socket.io] Client disconnected: ${socket.id}`);
  });
});

let shuttingDown = false;

function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[Server] Received ${signal}, shutting down gracefully...`);

  io.close(() => {
    httpServer.close((error) => {
      const closeError = error as NodeJS.ErrnoException | undefined;

      if (closeError && closeError.code !== 'ERR_SERVER_NOT_RUNNING') {
        console.error('[Server] Failed to close cleanly:', closeError);
        process.exit(1);
      }

      process.exit(0);
    });
  });

  setTimeout(() => {
    console.error('[Server] Forced shutdown after timeout');
    process.exit(1);
  }, 5000).unref();
}

const MAX_LISTEN_RETRIES = 10;
const LISTEN_RETRY_DELAY_MS = 300;
let listenRetries = 0;

httpServer.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    if (listenRetries < MAX_LISTEN_RETRIES) {
      listenRetries += 1;
      setTimeout(() => {
        httpServer.close(() => {
          // ignore — server may not be listening yet
        });
        httpServer.listen(PORT);
      }, LISTEN_RETRY_DELAY_MS).unref();
      return;
    }
    console.error(`[Server] Port ${PORT} is already in use after ${MAX_LISTEN_RETRIES} retries.`);
  } else {
    console.error('[Server] Failed to start:', error);
  }
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGUSR2'] as const) {
  process.on(signal, () => shutdown(signal));
}

httpServer.listen(PORT, () => {
  listenRetries = 0;
  console.log(`[Server] Running on http://localhost:${PORT} (Postgres mode)`);
  try {
    startCronJobs();
  } catch (e) {
    console.error('[Cron] Failed to start:', (e as Error).message);
  }
  // One-time fix: reclassify any stale HalfDay records
  fixHalfDayRecords().catch((e) => console.error('[AttendanceFix] Error:', (e as Error).message));
});

// Long-running endpoints like /api/attendance/sync-live and historical imports
// can take a couple of minutes when scraping the iClock portal. Default Node
// socket/idle timeouts kill the connection mid-flight ("socket hang up").
// Bumping these well above the slowest expected response avoids that.
httpServer.requestTimeout = 0;     // no per-request limit
httpServer.headersTimeout = 5 * 60 * 1000;  // 5 min
httpServer.keepAliveTimeout = 2 * 60 * 1000; // 2 min
httpServer.timeout = 5 * 60 * 1000; // 5 min idle

// Export for Vercel serverless
export default app;
