import 'dotenv/config'; // before any server module reads JWT_SECRET
import express from 'express';
import cookieParser from 'cookie-parser';
import { requestContext } from '../../../server/lib/requestContext';
import '../../../server/lib/userActivity';
import authRoutes from '../../../server/routes/auth';
import activityRoutes from '../../../server/routes/activity';
import operatorRoutes from '../../../server/routes/operator';
import adminRoutes from '../../../server/routes/admin';
import { apiErrorHandler } from '../../../server/middleware/errorHandler';

/**
 * An in-process copy of the API (same middleware order as server/index.ts and
 * netlify/functions/api.ts) for tests that change environment variables per test
 * (PLATFORM_OPERATOR_ALLOWED_IPS, ...) or swap the mailer (setMailerForTests): auth, admin, activity and
 * operator routes only (set data up through the live API). It uses the same local database as the live API.
 * `extra` mounts test-only routes (e.g. one that throws) before the error handler.
 */
export function buildApp(extra?: (app: express.Express) => void): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(requestContext);
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/activity', activityRoutes);
  app.use('/api/operator', operatorRoutes);
  extra?.(app);
  app.use(apiErrorHandler);
  return app;
}
