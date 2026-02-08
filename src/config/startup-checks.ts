/**
 * Startup validation checks for Task Orchestrator v3.
 *
 * Runs after config load and migrations. Emits warnings (non-fatal)
 * when the DB contains entities in states not present in the active
 * config pipeline.
 */

import { db } from '../db/client';
import { getPipeline, EXIT_STATE } from './index';

interface OrphanedState {
  entityType: 'feature' | 'task';
  status: string;
  count: number;
}

/**
 * Check for entities in states that are not in the active pipeline config.
 * Returns a list of orphaned states with counts.
 */
export function checkOrphanedStates(): OrphanedState[] {
  const orphaned: OrphanedState[] = [];

  for (const entityType of ['feature', 'task'] as const) {
    const table = entityType === 'feature' ? 'features' : 'tasks';
    const pipeline = getPipeline(entityType);
    const validStates = [...pipeline.states, EXIT_STATE];

    try {
      const rows = db
        .query<{ status: string; count: number }, []>(
          `SELECT status, COUNT(*) as count FROM ${table} GROUP BY status`
        )
        .all();

      for (const row of rows) {
        if (!validStates.includes(row.status)) {
          orphaned.push({
            entityType,
            status: row.status,
            count: row.count,
          });
        }
      }
    } catch {
      // Table might not exist yet (pre-migration). Skip.
    }
  }

  return orphaned;
}

/**
 * Run startup checks and emit warnings to stderr.
 * Non-fatal: never throws.
 */
export function runStartupChecks(): void {
  try {
    const orphaned = checkOrphanedStates();

    if (orphaned.length > 0) {
      console.error('[task-orchestrator] WARNING: Found entities in states not present in active pipeline config:');
      for (const o of orphaned) {
        console.error(`  - ${o.count} ${o.entityType}(s) in state "${o.status}"`);
      }
      console.error('[task-orchestrator] These entities may need manual migration or config update.');
    }
  } catch {
    // Startup checks are non-fatal
  }
}
