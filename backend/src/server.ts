import express from 'express';
import cors from 'cors';
import { config } from './config/index.ts';
import { cspMiddleware } from './middleware/csp.ts';
import { privacyLogger } from './middleware/privacyLogger.ts';
import { createAuthProvider } from './auth/index.ts';
import { healthRouter } from './routes/health.ts';
import { createAuthRouter } from './routes/auth.ts';
import { createCredentialsRouter } from './routes/credentials.ts';
import { createMonitoringRouter } from './routes/monitoring.ts';
import { configRouter } from './routes/config.ts';

export function createApp() {
  const app = express();

  // Disable technology footprint disclosure
  app.disable('x-powered-by');

  // Instantiate active AuthProvider behind AuthProvider interface
  // (Fails closed if misconfigured or if both providers are active)
  const authProvider = createAuthProvider(config.auth, config.env);

  // Security Headers & CSP
  app.use(cspMiddleware);

  // Privacy-Preserving Logging Middleware (Zero body/payload logging)
  app.use(privacyLogger);

  // CORS Policy
  app.use(
    cors({
      origin: config.corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  app.use(express.json({ limit: '100kb' }));

  /**
   * PERMITTED ENDPOINTS INVENTORY:
   * 1. Health check (/health & /api/v1/health)
   * 2. Authentication callbacks and token exchange (/api/v1/auth)
   * 3. Short-lived, scoped credential issuance (/api/v1/credentials)
   * 4. Monitoring event ingestion & aggregate health (/api/v1/monitoring)
   * 5. Non-sensitive configuration retrieval (/api/v1/config)
   */
  app.use('/health', healthRouter);
  app.use('/api/v1/health', healthRouter);
  app.use('/api/v1/auth', createAuthRouter(authProvider));
  app.use('/api/v1/credentials', createCredentialsRouter(authProvider));
  app.use('/api/v1/monitoring', createMonitoringRouter(authProvider));
  app.use('/api/v1/config', configRouter);

  return { app, authProvider };
}

export function startServer() {
  const { app } = createApp();
  const server = app.listen(config.port, () => {
    console.log(
      `[Case Ace Backend] Listening on port ${config.port} (env: ${config.env}, region: ${config.gcpRegion})`
    );
  });
  return server;
}

// Only auto-start server when executed directly as entrypoint, not when imported
const isMainModule = typeof process !== 'undefined' && process.argv[1] && (
  process.argv[1].endsWith('server.ts') ||
  process.argv[1].endsWith('server.js') ||
  process.env.START_SERVER === 'true'
);

if (isMainModule && process.env.NODE_ENV !== 'test') {
  startServer();
}
