import express, { Router } from 'express';
import serverless from 'serverless-http';
import cookieParser from 'cookie-parser';
import { testConnection } from '../../src/lib/db';
import { apiLimiter } from '../../server/middleware/rateLimit';

// Import routes - Note: These will be bundled by esbuild
import authRoutes from '../../server/routes/auth';
import teamsRoutes from '../../server/routes/teams';
import metricsRoutes from '../../server/routes/metrics';
import usersRoutes from '../../server/routes/users';
import departmentsRoutes from '../../server/routes/departments';
import adminRoutes from '../../server/routes/admin';
import analyticsRoutes from '../../server/routes/analytics';
import settingsRoutes from '../../server/routes/settings';
import ingestRoutes from '../../server/routes/ingest';
import tvRoutes from '../../server/routes/tv';
import summaryRoutes from '../../server/routes/summary';
import improveRoutes from '../../server/routes/improve';
import navigatorRoutes from '../../server/routes/navigator';
import collectionRoutes from '../../server/routes/collection';
import rolesRoutes from '../../server/routes/roles';
import targetsRoutes from '../../server/routes/targets';
import ingestionLogRoutes from '../../server/routes/ingestionLog';
import compareRoutes from '../../server/routes/compare';
import revenueImpactRoutes from '../../server/routes/revenueImpact';
import savedViewsRoutes from '../../server/routes/savedViews';
import onboardingRoutes from '../../server/routes/onboarding';
import pulseRoutes from '../../server/routes/pulse';
import alertsRoutes from '../../server/routes/alerts';
import notificationsRoutes from '../../server/routes/notifications';
import actionsRoutes from '../../server/routes/actions';
import activityRoutes from '../../server/routes/activity';
import operatorRoutes from '../../server/routes/operator';
import ciRoutes from '../../server/routes/ci';
import uploadsRoutes from '../../server/routes/uploads';
import { isRawIngestPath } from '../../server/lib/ingest/body';
import { requestContext } from '../../server/lib/requestContext';
import '../../server/lib/userActivity'; // user activity log (request hook)
import { apiErrorHandler } from '../../server/middleware/errorHandler';
import { flushBackgroundWrites } from '../../server/lib/opsLog';
import { isProductionRuntime } from '../../server/lib/runtimeEnv';

const app = express();

// Netlify runs functions behind its edge proxy; trust it so the rate limiter
// keys on the real client IP (from x-forwarded-for) rather than the proxy.
app.set('trust proxy', true);
// Netlify's edge sets x-nf-client-connection-ip (the real client); server/lib/requestContext.ts clientIp.
app.locals.behindNetlify = true;

// Request id, client IP and route pattern for the logs (server/lib/requestContext.ts): first.
app.use(requestContext);

// Allowed origins for CORS (production + local dev)
const allowedOrigins = [
  process.env.URL,                    // Netlify deploy URL (auto-set by Netlify)
  process.env.DEPLOY_PRIME_URL,       // Netlify branch deploy URL
  process.env.DEPLOY_URL,             // This deploy's unique URL
  process.env.FRONTEND_URL,           // Custom domain, if any
  // Local dev origins only outside production (server/lib/runtimeEnv.ts): on the live site a page
  // served from someone's localhost must not make credentialed calls.
  ...(isProductionRuntime() ? [] : ['http://localhost:5173', 'http://localhost:3000']),
].filter(Boolean);

// Manual CORS handling to ensure proper origin reflection with credentials
app.use((req, res, next) => {
  const origin = req.headers.origin as string | undefined;
  
  // Exact match only, as in server/index.ts: a suffix check would let any other
  // *.netlify.app site make credentialed requests.
  const isAllowed = origin && allowedOrigins.some(allowed => origin === allowed);
  
  if (isAllowed) {
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

// Rate limiting (per warm instance — see server/middleware/rateLimit.ts).
app.use(apiLimiter);

// Routes - Note: Netlify Functions already adds /.netlify/functions/api prefix
const router = Router();
router.use('/auth', authRoutes);
router.use('/teams', teamsRoutes);
router.use('/metrics', metricsRoutes);
router.use('/users', usersRoutes);
router.use('/departments', departmentsRoutes);
router.use('/admin', adminRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/settings', settingsRoutes);
router.use('/ingest', ingestRoutes);
// IRONGATE_URL ends in /api and the documented raw-ingestion URLs add /api/ingest: /api/api/ingest/… answers too.
router.use('/api/ingest', ingestRoutes);
router.use('/tv', tvRoutes);
router.use('/summary', summaryRoutes);
router.use('/improve', improveRoutes);
router.use('/navigator', navigatorRoutes);
router.use('/collection-schedule', collectionRoutes);
router.use('/roles', rolesRoutes);
router.use('/targets', targetsRoutes);
router.use('/ingestion-log', ingestionLogRoutes);
router.use('/compare', compareRoutes);
router.use('/revenue-impact', revenueImpactRoutes);
router.use('/saved-views', savedViewsRoutes);
router.use('/onboarding', onboardingRoutes);
router.use('/pulse', pulseRoutes);
router.use('/alerts', alertsRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/actions', actionsRoutes);
router.use('/activity', activityRoutes);
router.use('/operator', operatorRoutes);
router.use('/ci', ciRoutes);
router.use('/uploads', uploadsRoutes);

// Health check: /health (netlify.toml sends it to this function) and /api/health
app.get(['/health', '/api/health'], (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: 'netlify-functions'
  });
});

app.use('/api', router);
app.use('/', router); // Also support without /api prefix

// Error handling (server/middleware/errorHandler.ts): never returns the detail to the client.
app.use(apiErrorHandler);

// Test DB connection on cold start
testConnection().catch(err => {
  console.error('Database connection failed:', err);
});

// Export as serverless function.
// The instance is frozen as soon as the handler resolves, so the background log writes of this
// request (user activity, server errors: server/lib/opsLog.ts) are awaited before the answer is
// returned (FI-23). Normally one insert (one database round trip); capped so a slow database never
// holds an answer longer than FLUSH_MAX_MS. Writes left over from an earlier invocation are not awaited.
export const FLUSH_MAX_MS = 2500;
let invocationStart = 0;
export const handler = serverless(app, {
  request: () => { invocationStart = Date.now(); },
  response: async () => { await flushBackgroundWrites(FLUSH_MAX_MS, { startedSince: invocationStart }); },
});
