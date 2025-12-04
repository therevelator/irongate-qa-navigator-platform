import express, { Router } from 'express';
import serverless from 'serverless-http';
import cookieParser from 'cookie-parser';
import { testConnection } from '../../src/lib/db';

// Import routes - Note: These will be bundled by esbuild
import authRoutes from '../../server/routes/auth';
import teamsRoutes from '../../server/routes/teams';
import metricsRoutes from '../../server/routes/metrics';
import usersRoutes from '../../server/routes/users';
import departmentsRoutes from '../../server/routes/departments';
import adminRoutes from '../../server/routes/admin';
import analyticsRoutes from '../../server/routes/analytics';
import settingsRoutes from '../../server/routes/settings';

const app = express();

// Allowed origins for CORS (production + local dev)
const allowedOrigins = [
  process.env.URL,                    // Netlify deploy URL (auto-set by Netlify)
  process.env.DEPLOY_PRIME_URL,       // Netlify branch deploy URL
  'http://localhost:5173',            // Local dev
  'http://localhost:3000',
].filter(Boolean);

// Manual CORS handling to ensure proper origin reflection with credentials
app.use((req, res, next) => {
  const origin = req.headers.origin as string | undefined;
  
  // Only allow specific origins (not open to any domain)
  const isAllowed = origin && allowedOrigins.some(allowed => 
    origin === allowed || origin.endsWith('.netlify.app')
  );
  
  if (isAllowed) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Vary', 'Origin');
  }
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  
  next();
});

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

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

app.use('/api', router);
app.use('/', router); // Also support without /api prefix

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: 'netlify-functions'
  });
});

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// Test DB connection on cold start
testConnection().catch(err => {
  console.error('Database connection failed:', err);
});

// Export as serverless function
export const handler = serverless(app);
