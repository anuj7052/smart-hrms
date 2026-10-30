import express from 'express';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/auth';
import esslRoutes from './routes/essl';
import employeesRoutes from './routes/employees';
import leavesRoutes from './routes/leaves';
import settingsRoutes from './routes/settings';
import attendanceRoutes from './routes/attendance';
import reportsRoutes from './routes/reports';
import devicesRoutes from './routes/devices';
import iclockRoutes from './routes/iclock';
import dashboardRoutes from './routes/dashboard';
import holidaysRoutes from './routes/holidays';
import { errorHandler } from './middleware/errorHandler';

const app = express();

// Trust Azure App Service / reverse proxy (fixes express-rate-limit X-Forwarded-For warning)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "https://login.microsoftonline.com", "https://*.microsoftonline.com", "https://graph.microsoft.com"],
      frameSrc: ["'self'", "https://login.microsoftonline.com"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
    },
  },
}));

// gzip/deflate every response — dashboard and reports payloads compress 5-10x.
app.use(compression());

// Allow the web app, Expo web, Expo Go on a LAN, and any explicitly-configured origin.
const DEFAULT_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8081',
  'http://127.0.0.1:8081',
  'http://localhost:8082',
  'http://127.0.0.1:8082',
  'http://localhost:19006',
  'http://127.0.0.1:19006',
];
const EXTRA_ORIGINS = [process.env.CLIENT_URL, process.env.PUBLIC_APP_ORIGIN]
  .filter(Boolean)
  .join(',')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = new Set<string>([...DEFAULT_DEV_ORIGINS, ...EXTRA_ORIGINS]);
const LOCAL_DEV_ORIGIN_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1)(:(3000|4173|5000|517[3-9]|518\d|519\d|8081|8082|19006))?$/;
// Match LAN IPs on common dev ports (Vite 5173, Metro 8081, Expo 19006).
const LAN_ORIGIN_REGEX = /^https?:\/\/(\d{1,3}\.){3}\d{1,3}(:(5173|8081|8082|19006|5000))?$/;
// Match Vercel preview/production deployments
const VERCEL_ORIGIN_REGEX = /^https:\/\/.*\.vercel\.app$/;

app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin / curl / native apps with no Origin header.
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.has(origin) || LOCAL_DEV_ORIGIN_REGEX.test(origin) || LAN_ORIGIN_REGEX.test(origin) || VERCEL_ORIGIN_REGEX.test(origin)) {
      return cb(null, true);
    }
    return cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// Rate limiting (disabled in development to avoid false 429s)
const isDev = process.env.NODE_ENV !== 'production';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 0 : 100, // 0 = unlimited in dev
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isDev,
});
app.use('/api', limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 0 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isDev,
  message: { message: 'Too many auth requests, please try again later.' },
});

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// ─── Postgres-backed routes (production architecture) ───────────────────────
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/essl', esslRoutes);
app.use('/api/employees', employeesRoutes);
app.use('/api/leaves', leavesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/holidays', holidaysRoutes);
// eSSL iClock push protocol endpoint (devices POST punches here directly)
app.use('/iclock', iclockRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', mode: 'postgres', timestamp: new Date().toISOString() });
});

// ─── Serve built frontend (single-container deployment, e.g. Azure Container Apps) ───
// FRONTEND_DIST_PATH can override the location; defaults to ../public relative
// to the compiled backend (dist/). The Dockerfile copies frontend/dist there.
const FRONTEND_DIST = process.env.FRONTEND_DIST_PATH
  || path.resolve(__dirname, '../public');
if (fs.existsSync(path.join(FRONTEND_DIST, 'index.html'))) {
  app.use(express.static(FRONTEND_DIST, { maxAge: '1h', index: false }));
  // SPA fallback — anything not under /api or /iclock returns index.html
  app.get(/^\/(?!api|iclock|socket\.io).*/, (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
  console.log(`[Server] Serving frontend from ${FRONTEND_DIST}`);
}

// Error handler (must be last)
app.use(errorHandler);

export default app;
