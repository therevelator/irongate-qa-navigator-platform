import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { testConnection } from '../src/lib/db';
import { setupWebSocket, broadcast } from './websocket';
import { jobEvents } from './eventBus';
import { apiLimiter } from './middleware/rateLimit';
import authRoutes from './routes/auth';
import teamsRoutes from './routes/teams';
import metricsRoutes from './routes/metrics';
import usersRoutes from './routes/users';
import departmentsRoutes from './routes/departments';
import adminRoutes from './routes/admin';
import settingsRoutes from './routes/settings';
import analyticsRoutes from './routes/analytics';
import ingestRoutes from './routes/ingest';
import tvRoutes from './routes/tv';
import summaryRoutes from './routes/summary';
import improveRoutes from './routes/improve';
import targetsRoutes from './routes/targets';
import ingestionLogRoutes from './routes/ingestionLog';
import compareRoutes from './routes/compare';
import revenueImpactRoutes from './routes/revenueImpact';
import savedViewsRoutes from './routes/savedViews';
import onboardingRoutes from './routes/onboarding';
import pulseRoutes from './routes/pulse';
import alertsRoutes from './routes/alerts';
import notificationsRoutes from './routes/notifications';
import actionsRoutes from './routes/actions';
// import './jobs/syncMetrics'; // Start cron jobs (disabled temporarily)
import './jobs/intervalSync'; // Interval-based metric sync
import './jobs/analyticsSync'; // Analytics data sync
import './jobs/alertsCron'; // Alert evaluation, notification outbox, weekly digest
import './jobs/pulseCron'; // Automatic wellbeing pulse e-mail per team cadence
import './jobs/cleanupCron'; // Retention of server_errors / user_activity / job_runs
import activityRoutes from './routes/activity';
import ciRoutes from './routes/ci';
import uploadsRoutes from './routes/uploads';
import operatorRoutes from './routes/operator';
import { isRawIngestPath } from './lib/ingest/body';
import { requestContext } from './lib/requestContext';
import './lib/userActivity'; // user activity log (request hook)
import { apiErrorHandler } from './middleware/errorHandler';

const app = express();
const PORT = process.env.PORT || 3000;

// Behind the Railway/Netlify proxy: trust one hop so req.ip (used by the rate
// limiter) reflects the real client, not the proxy.
app.set('trust proxy', 1);

// Create HTTP server
const server = http.createServer(app);

// Setup WebSocket
export const wss = setupWebSocket(server);

jobEvents.on('job-notification', (payload) => {
  broadcast(wss, {
    type: 'JOB_NOTIFICATION',
    ...payload,
  });
});

// Request id, client IP and route pattern for the logs (server/lib/requestContext.ts): first.
app.use(requestContext);

// Middleware
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
  'http://localhost:5177',
  'http://localhost:5178',
  'http://localhost:3000',
  // src/config/api.ts treats 127.0.0.1 as local dev too (exact origins, with port)
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  process.env.FRONTEND_URL
].filter(Boolean);

// Manual CORS handling to ensure proper origin reflection with credentials
app.use((req, res, next) => {
  const origin = req.headers.origin as string | undefined;
  
  // Check if origin is allowed
  // Exact match — startsWith would let http://localhost:5173.evil.com through.
  const isAllowed = !origin || allowedOrigins.some(allowed => allowed && origin === allowed);
  
  if (isAllowed && origin) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id, X-Operator-Token');
    res.header('Access-Control-Expose-Headers', 'X-Request-Id');
    res.header('Vary', 'Origin');
  }
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  
  next();
});

app.use(cookieParser());
// The raw ingestion endpoints (tests, coverage, pipelines, deployments, commits, incidents) read their own body (files up to 20 MB, gzip).
const jsonParser = express.json();
const formParser = express.urlencoded({ extended: true });
app.use((req, res, next) => (isRawIngestPath(req.path) ? next() : jsonParser(req, res, next)));
app.use((req, res, next) => (isRawIngestPath(req.path) ? next() : formParser(req, res, next)));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api', apiLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/teams', teamsRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/departments', departmentsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/ingest', ingestRoutes);
app.use('/api/tv', tvRoutes);
app.use('/api/summary', summaryRoutes);
app.use('/api/improve', improveRoutes);
app.use('/api/targets', targetsRoutes);
app.use('/api/ingestion-log', ingestionLogRoutes);
app.use('/api/compare', compareRoutes);
app.use('/api/revenue-impact', revenueImpactRoutes);
app.use('/api/saved-views', savedViewsRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/pulse', pulseRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/actions', actionsRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/operator', operatorRoutes);
app.use('/api/ci', ciRoutes);
app.use('/api/uploads', uploadsRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Serve the built frontend in production (Railway single-service deployment)
if (process.env.NODE_ENV === 'production') {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const distPath = path.resolve(__dirname, '../dist');

  app.use(express.static(distPath, {
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    }
  }));

  // SPA fallback for client-side routes (everything except /api and /health)
  app.get(/^\/(?!api\/|health$).*/, (req, res) => {
    // The reset page's address carries a one-time token: never send it on as a Referer.
    if (req.path === '/reset-password') res.setHeader('Referrer-Policy', 'no-referrer');
    // The self-serve demo page is never indexed (netlify.toml sets the same header there).
    if (req.path === '/try' || req.path === '/try/') res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Error handling (server/middleware/errorHandler.ts): never returns the detail to the client.
app.use(apiErrorHandler);

// Start server
async function start() {
  try {
    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      console.error('Failed to connect to database. Exiting...');
      process.exit(1);
    }

    // Start server
    server.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`📊 API available at http://localhost:${PORT}/api`);
      console.log(`🔌 WebSocket server running`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
