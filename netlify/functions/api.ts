import express, { Router } from 'express';
import serverless from 'serverless-http';
import cors from 'cors';
import { testConnection } from '../../src/lib/db';

// Import routes - Note: These will be bundled by esbuild
import authRoutes from '../../server/routes/auth';
import teamsRoutes from '../../server/routes/teams';
import metricsRoutes from '../../server/routes/metrics';
import usersRoutes from '../../server/routes/users';
import departmentsRoutes from '../../server/routes/departments';
import adminRoutes from '../../server/routes/admin';

const app = express();

// Middleware
app.use(cors({
  origin: true, // Allow all origins in serverless (Netlify handles this)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
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
