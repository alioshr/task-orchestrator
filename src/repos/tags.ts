import { db, queryAll, queryOne, execute, ok, err, generateId, now } from './base';
import type { Result } from '../domain/types';
import { transaction } from '../db/client';

// ============================================================================
// Types
// ============================================================================

export interface TagCount {
  tag: string;
  count: number;
}

export interface TagUsage {
  entityId: string;
  entityType: string;
}

export interface RenameTagParams {
  dryRun?: boolean;
}

export interface RenameTagResult {
  affected: number;
  entities: TagUsage[];
}

// ============================================================================
// Repository Functions
// ============================================================================

/**
 * List all tags with their usage counts
 * @param params Optional filter by entity type
 * @returns Array of tags with counts, ordered by count DESC, tag ASC
 */
export function listTags(params?: { entityType?: string }): Result<TagCount[]> {
  try {
    let sql = `
      SELECT tag, COUNT(*) as count
      FROM entity_tags
    `;
    const sqlParams: string[] = [];

    if (params?.entityType) {
      sql += ' WHERE entity_type = ?';
      sqlParams.push(params.entityType);
    }

    sql += ' GROUP BY tag ORDER BY count DESC, tag ASC';

    const rows = queryAll<TagCount>(sql, sqlParams);
    return ok(rows);
  } catch (error) {
    return err(`Failed to list tags: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get all entities using a specific tag
 * @param tag The tag to search for (case-insensitive)
 * @returns Array of entity IDs and types
 */
export function getTagUsage(tag: string): Result<TagUsage[]> {
  try {
    const normalizedTag = tag.trim().toLowerCase();
    if (!normalizedTag) {
      return err('Tag cannot be empty', 'VALIDATION_ERROR');
    }

    const rows = queryAll<TagUsage>(
      `SELECT entity_id as entityId, entity_type as entityType
       FROM entity_tags
       WHERE LOWER(tag) = ?
       ORDER BY entity_type, entity_id`,
      [normalizedTag]
    );

    return ok(rows);
  } catch (error) {
    return err(`Failed to get tag usage: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Rename a tag across all entities
 * @param oldTag The current tag name
 * @param newTag The new tag name
 * @param params Optional dry run mode
 * @returns Number of affected rows and list of entities
 */
export function renameTag(
  oldTag: string,
  newTag: string,
  params?: RenameTagParams
): Result<RenameTagResult> {
  try {
    const normalizedOldTag = oldTag.trim().toLowerCase();
    const normalizedNewTag = newTag.trim().toLowerCase();

    // Validation
    if (!normalizedOldTag) {
      return err('Old tag cannot be empty', 'VALIDATION_ERROR');
    }
    if (!normalizedNewTag) {
      return err('New tag cannot be empty', 'VALIDATION_ERROR');
    }
    if (normalizedOldTag === normalizedNewTag) {
      return err('Old and new tags are the same', 'VALIDATION_ERROR');
    }

    // Get all entities using the old tag
    const entities = queryAll<{ entity_id: string; entity_type: string }>(
      'SELECT entity_id, entity_type FROM entity_tags WHERE LOWER(tag) = ?',
      [normalizedOldTag]
    );

    if (entities.length === 0) {
      return ok({ affected: 0, entities: [] });
    }

    // If dry run, just return the count
    if (params?.dryRun) {
      return ok({
        affected: entities.length,
        entities: entities.map(e => ({
          entityId: e.entity_id,
          entityType: e.entity_type
        }))
      });
    }

    // Execute the rename in a transaction
    const result = transaction(() => {
      let updated = 0;
      let deleted = 0;

      for (const entity of entities) {
        // Check if the entity already has the new tag
        const existing = queryOne<{ count: number }>(
          'SELECT COUNT(*) as count FROM entity_tags WHERE entity_id = ? AND entity_type = ? AND LOWER(tag) = ?',
          [entity.entity_id, entity.entity_type, normalizedNewTag]
        );

        if (existing && existing.count > 0) {
          // Conflict: entity already has the new tag, delete the old tag row
          execute(
            'DELETE FROM entity_tags WHERE entity_id = ? AND entity_type = ? AND LOWER(tag) = ?',
            [entity.entity_id, entity.entity_type, normalizedOldTag]
          );
          deleted++;
        } else {
          // No conflict: update the old tag to the new tag
          execute(
            'UPDATE entity_tags SET tag = ? WHERE entity_id = ? AND entity_type = ? AND LOWER(tag) = ?',
            [normalizedNewTag, entity.entity_id, entity.entity_type, normalizedOldTag]
          );
          updated++;
        }
      }

      return updated + deleted;
    });

    return ok({
      affected: result,
      entities: entities.map(e => ({
        entityId: e.entity_id,
        entityType: e.entity_type
      }))
    });
  } catch (error) {
    return err(`Failed to rename tag: ${error instanceof Error ? error.message : String(error)}`);
  }
}
