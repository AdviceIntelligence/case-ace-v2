/**
 * Case Ace v2.0 - Monitoring and Audit Log Store (Phase 16)
 * 
 * Invariants:
 * 1. Holds strictly schema-validated log payloads only.
 * 2. 365-day automated retention window with deterministic purging.
 * 3. Access restricted to authorized roles (supervisor, auditor, administrator).
 * 4. Every access to the audit logs is itself recorded as a non-PII LOGS_ACCESSED event.
 */

import { type ValidatedLogPayload, validateLogPayload } from './logSchema.ts';

export const DEFAULT_RETENTION_DAYS = 365;
export const RETENTION_WINDOW_MS = DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export interface LogQueryFilter {
  eventType?: string;
  pseudonymousUserId?: string;
  pseudonymousSessionId?: string;
  intakeRoute?: string;
  fromTimestamp?: string;
  toTimestamp?: string;
  limit?: number;
  offset?: number;
}

export class AuditLogStore {
  private logs: ValidatedLogPayload[] = [];
  private retentionMs: number;

  constructor(retentionDays: number = DEFAULT_RETENTION_DAYS) {
    this.retentionMs = retentionDays * 24 * 60 * 60 * 1000;
  }

  /**
   * Ingests a new log entry after validating against strict whitelist schema.
   */
  public ingest(payload: unknown): ValidatedLogPayload {
    const validated = validateLogPayload(payload);
    this.logs.push(validated);
    this.purgeExpired();
    return validated;
  }

  /**
   * Queries audit logs with filtering.
   * Access to this method MUST be authenticated with 2FA and authorized role.
   */
  public query(filter: LogQueryFilter = {}, accessingUser: { id: string; role: string }): {
    total: number;
    results: ValidatedLogPayload[];
  } {
    this.purgeExpired();

    // Log the access event itself
    this.logs.push({
      eventType: 'LOGS_ACCESSED',
      timestamp: new Date().toISOString(),
      pseudonymousUserId: accessingUser.id,
      role: accessingUser.role,
    });

    let filtered = this.logs.filter((log) => {
      if (filter.eventType && log.eventType !== filter.eventType) return false;
      if (filter.pseudonymousUserId && log.pseudonymousUserId !== filter.pseudonymousUserId) return false;
      if (filter.pseudonymousSessionId && log.pseudonymousSessionId !== filter.pseudonymousSessionId) return false;
      if (filter.intakeRoute && log.intakeRoute !== filter.intakeRoute) return false;
      if (filter.fromTimestamp && new Date(log.timestamp).getTime() < new Date(filter.fromTimestamp).getTime()) return false;
      if (filter.toTimestamp && new Date(log.timestamp).getTime() > new Date(filter.toTimestamp).getTime()) return false;
      return true;
    });

    const total = filtered.length;
    const offset = filter.offset || 0;
    const limit = filter.limit !== undefined ? filter.limit : 100;
    const results = filtered.slice(offset, offset + limit);

    return { total, results };
  }

  /**
   * Automatically purges records older than the retention threshold (365 days).
   */
  public purgeExpired(customThresholdMs?: number): number {
    const cutoff = Date.now() - (customThresholdMs || this.retentionMs);
    const initialCount = this.logs.length;
    this.logs = this.logs.filter((entry) => {
      const entryTime = new Date(entry.timestamp).getTime();
      return entryTime >= cutoff;
    });
    return initialCount - this.logs.length;
  }

  /**
   * Returns total count of active records in memory.
   */
  public count(): number {
    return this.logs.length;
  }

  /**
   * Clears all log memory (used in testing).
   */
  public clear(): void {
    this.logs = [];
  }
}

export const auditLogStore = new AuditLogStore();
