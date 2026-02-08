/**
 * Shared helpers for v3 pipeline tools (advance, terminate, block, unblock).
 *
 * Centralizes auto-unblock logic, affected-dependent queries, and common utilities
 * so that advance and terminate share a single implementation.
 */

import { queryAll, execute, now } from '../repos/base';

export function parseJsonArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getTable(containerType: string): string {
  return containerType === 'task' ? 'tasks' : 'features';
}

/**
 * Remove entityId from blocked_by arrays of all tasks and features that reference it.
 * Returns list of entities that were fully unblocked (blocked_by became empty).
 */
export function autoUnblock(entityId: string): Array<{ id: string; type: 'task' | 'feature' }> {
  const unblocked: Array<{ id: string; type: 'task' | 'feature' }> = [];
  const timestamp = now();

  for (const table of ['tasks', 'features'] as const) {
    const type = table === 'tasks' ? 'task' : 'feature';
    const rows = queryAll<{ id: string; blocked_by: string; blocked_reason: string | null; version: number }>(
      `SELECT id, blocked_by, blocked_reason, version FROM ${table} WHERE EXISTS (SELECT 1 FROM json_each(${table}.blocked_by) WHERE value = ?)`,
      [entityId]
    );

    for (const row of rows) {
      const blockers = parseJsonArray(row.blocked_by);
      if (!blockers.includes(entityId)) continue;

      const newBlockers = blockers.filter(b => b !== entityId);
      const newBlockedBy = JSON.stringify(newBlockers);
      const clearReason = !newBlockers.includes('NO_OP');

      execute(
        `UPDATE ${table} SET blocked_by = ?, blocked_reason = ?, version = version + 1, modified_at = ? WHERE id = ?`,
        [newBlockedBy, clearReason ? null : row.blocked_reason, timestamp, row.id]
      );

      if (newBlockers.length === 0) {
        unblocked.push({ id: row.id, type });
      }
    }
  }

  return unblocked;
}

/**
 * Find all entities that reference the given entityId in their blocked_by.
 * Does NOT modify them — just queries.
 */
export function findAffectedDependents(entityId: string): Array<{ id: string; type: 'task' | 'feature' }> {
  const dependents: Array<{ id: string; type: 'task' | 'feature' }> = [];

  for (const table of ['tasks', 'features'] as const) {
    const type = table === 'tasks' ? 'task' : 'feature';
    const rows = queryAll<{ id: string; blocked_by: string }>(
      `SELECT id, blocked_by FROM ${table} WHERE EXISTS (SELECT 1 FROM json_each(${table}.blocked_by) WHERE value = ?)`,
      [entityId]
    );
    for (const row of rows) {
      const blockers = parseJsonArray(row.blocked_by);
      if (blockers.includes(entityId)) {
        dependents.push({ id: row.id, type });
      }
    }
  }

  return dependents;
}
