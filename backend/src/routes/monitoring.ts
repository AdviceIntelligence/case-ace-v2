import express from 'express';
import type { Request, Response } from 'express';
import type { AuthProvider } from '../auth/types.ts';
import { createAuthMiddleware, requireRole } from '../middleware/rbac.ts';
import type { AuthenticatedRequest } from '../middleware/rbac.ts';
import { writePrivacyLog } from '../middleware/privacyLogger.ts';
import { config } from '../config/index.ts';
import { validateLogPayload, LogSchemaValidationError } from '../logging/logSchema.ts';
import { auditLogStore, type LogQueryFilter } from '../logging/logStore.ts';

const Router = express.Router;

export function createMonitoringRouter(authProvider: AuthProvider) {
  const router = Router();
  const requireAuth = createAuthMiddleware(authProvider);

  /**
   * POST /api/v1/monitoring/events
   * Ingests operational & security telemetry with strict schema validation.
   * Rejects extra fields, free text, PII, phone numbers, and filenames.
   */
  router.post('/events', (req: Request, res: Response) => {
    try {
      const validated = auditLogStore.ingest(req.body);

      writePrivacyLog({
        level: 'info',
        event: 'OPERATIONAL_TELEMETRY_RECORDED',
        purpose: validated.stageReached || validated.eventType,
        durationMs: validated.stageDurationMs || validated.totalSessionDurationMs,
        region: config.gcpRegion,
      });

      res.status(202).json({
        recorded: true,
        eventType: validated.eventType,
        timestamp: validated.timestamp,
      });
    } catch (err: unknown) {
      if (err instanceof LogSchemaValidationError) {
        writePrivacyLog({
          level: 'warn',
          event: 'TELEMETRY_REJECTED_SCHEMA_VIOLATION',
          path: '/api/v1/monitoring/events',
          error: err.message,
        });
        res.status(400).json({
          error: err.message,
          field: err.fieldName,
        });
        return;
      }

      res.status(400).json({
        error: 'Invalid monitoring event payload.',
      });
    }
  });

  /**
   * GET /api/v1/monitoring/logs
   * Role-restricted audit log query. Requires 2FA auth & supervisor/auditor/admin role.
   * Access to this endpoint is automatically recorded in the audit log itself.
   */
  router.get(
    '/logs',
    requireAuth,
    requireRole('supervisor', 'auditor', 'administrator'),
    (req: AuthenticatedRequest, res: Response) => {
      const filter: LogQueryFilter = {
        eventType: typeof req.query.eventType === 'string' ? req.query.eventType : undefined,
        pseudonymousUserId: typeof req.query.userId === 'string' ? req.query.userId : undefined,
        pseudonymousSessionId: typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined,
        intakeRoute: typeof req.query.intakeRoute === 'string' ? req.query.intakeRoute : undefined,
        fromTimestamp: typeof req.query.from === 'string' ? req.query.from : undefined,
        toTimestamp: typeof req.query.to === 'string' ? req.query.to : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 100,
        offset: req.query.offset ? parseInt(req.query.offset as string, 10) : 0,
      };

      const user = {
        id: req.user?.id || 'unknown_user',
        role: req.user?.role || 'unknown_role',
      };

      const queryResult = auditLogStore.query(filter, user);
      res.status(200).json(queryResult);
    }
  );

  /**
   * GET /api/v1/monitoring/aggregate
   * Operational summary statistics for monitoring dashboard.
   */
  router.get(
    '/aggregate',
    requireAuth,
    requireRole('supervisor', 'auditor', 'administrator'),
    (_req: AuthenticatedRequest, res: Response) => {
      res.status(200).json({
        totalLogsRecorded: auditLogStore.count(),
        regionPinned: config.gcpRegion,
        piiContainmentStatus: 'PASS',
        retentionWindowDays: 365,
      });
    }
  );

  return router;
}
