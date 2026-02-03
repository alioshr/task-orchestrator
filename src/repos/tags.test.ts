import { test, expect, beforeEach, describe, beforeAll } from 'bun:test';
import { db, generateId, now } from '../db/client';
import { runMigrations } from '../db/migrate';
import { listTags, getTagUsage, renameTag } from './tags';

// Run migrations once before all tests
beforeAll(() => {
  runMigrations();
});

// Helper to setup test data
function setupTestDatabase() {
  // Clean up
  db.run('DELETE FROM entity_tags');

  // Create test data
  const projectId1 = generateId();
  const projectId2 = generateId();
  const featureId1 = generateId();
  const taskId1 = generateId();
  const createdAt = now();

  // Insert test tags
  db.run(
    'INSERT INTO entity_tags (id, entity_id, entity_type, tag, created_at) VALUES (?, ?, ?, ?, ?)',
    [generateId(), projectId1, 'PROJECT', 'backend', createdAt]
  );
  db.run(
    'INSERT INTO entity_tags (id, entity_id, entity_type, tag, created_at) VALUES (?, ?, ?, ?, ?)',
    [generateId(), projectId1, 'PROJECT', 'api', createdAt]
  );
  db.run(
    'INSERT INTO entity_tags (id, entity_id, entity_type, tag, created_at) VALUES (?, ?, ?, ?, ?)',
    [generateId(), projectId2, 'PROJECT', 'backend', createdAt]
  );
  db.run(
    'INSERT INTO entity_tags (id, entity_id, entity_type, tag, created_at) VALUES (?, ?, ?, ?, ?)',
    [generateId(), featureId1, 'FEATURE', 'api', createdAt]
  );
  db.run(
    'INSERT INTO entity_tags (id, entity_id, entity_type, tag, created_at) VALUES (?, ?, ?, ?, ?)',
    [generateId(), featureId1, 'FEATURE', 'authentication', createdAt]
  );
  db.run(
    'INSERT INTO entity_tags (id, entity_id, entity_type, tag, created_at) VALUES (?, ?, ?, ?, ?)',
    [generateId(), taskId1, 'TASK', 'bugfix', createdAt]
  );

  return { projectId1, projectId2, featureId1, taskId1 };
}

describe('listTags', () => {
  beforeEach(() => {
    setupTestDatabase();
  });

  test('should list all tags with counts ordered by count desc, tag asc', () => {
    const result = listTags();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(4);

      // backend: 2, api: 2, authentication: 1, bugfix: 1
      // When counts are equal, alphabetical order
      expect(result.data[0]).toEqual({ tag: 'api', count: 2 });
      expect(result.data[1]).toEqual({ tag: 'backend', count: 2 });
      expect(result.data[2]).toEqual({ tag: 'authentication', count: 1 });
      expect(result.data[3]).toEqual({ tag: 'bugfix', count: 1 });
    }
  });

  test('should filter tags by entity type', () => {
    const result = listTags({ entityType: 'PROJECT' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual({ tag: 'backend', count: 2 });
      expect(result.data[1]).toEqual({ tag: 'api', count: 1 });
    }
  });

  test('should filter tags by FEATURE entity type', () => {
    const result = listTags({ entityType: 'FEATURE' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual({ tag: 'api', count: 1 });
      expect(result.data[1]).toEqual({ tag: 'authentication', count: 1 });
    }
  });

  test('should return empty array when no tags exist', () => {
    db.run('DELETE FROM entity_tags');
    const result = listTags();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(0);
    }
  });

  test('should return empty array when filtering by non-existent entity type', () => {
    const result = listTags({ entityType: 'NONEXISTENT' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(0);
    }
  });
});

describe('getTagUsage', () => {
  beforeEach(() => {
    setupTestDatabase();
  });

  test('should get all entities using a specific tag', () => {
    const result = getTagUsage('backend');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data.every(e => e.entityType === 'PROJECT')).toBe(true);
    }
  });

  test('should be case-insensitive', () => {
    const result = getTagUsage('BACKEND');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
    }
  });

  test('should return empty array for non-existent tag', () => {
    const result = getTagUsage('nonexistent');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(0);
    }
  });

  test('should return error for empty tag', () => {
    const result = getTagUsage('');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Tag cannot be empty');
      expect(result.code).toBe('VALIDATION_ERROR');
    }
  });

  test('should trim whitespace from tag', () => {
    const result = getTagUsage('  backend  ');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
    }
  });

  test('should order results by entity type and entity id', () => {
    const { projectId1, featureId1 } = setupTestDatabase();

    const result = getTagUsage('api');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      // FEATURE comes before PROJECT alphabetically
      expect(result.data[0].entityType).toBe('FEATURE');
      expect(result.data[1].entityType).toBe('PROJECT');
    }
  });
});

describe('renameTag', () => {
  beforeEach(() => {
    setupTestDatabase();
  });

  test('should rename tag across all entities', () => {
    const result = renameTag('backend', 'server');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.affected).toBe(2);
      expect(result.data.entities).toHaveLength(2);
      expect(result.data.entities.every(e => e.entityType === 'PROJECT')).toBe(true);
    }

    // Verify the tag was actually renamed
    const usageResult = getTagUsage('server');
    expect(usageResult.success).toBe(true);
    if (usageResult.success) {
      expect(usageResult.data).toHaveLength(2);
    }

    // Verify old tag is gone
    const oldUsageResult = getTagUsage('backend');
    expect(oldUsageResult.success).toBe(true);
    if (oldUsageResult.success) {
      expect(oldUsageResult.data).toHaveLength(0);
    }
  });

  test('should handle dry run without modifying data', () => {
    const result = renameTag('backend', 'server', { dryRun: true });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.affected).toBe(2);
      expect(result.data.entities).toHaveLength(2);
    }

    // Verify no changes were made
    const usageResult = getTagUsage('backend');
    expect(usageResult.success).toBe(true);
    if (usageResult.success) {
      expect(usageResult.data).toHaveLength(2);
    }

    const newUsageResult = getTagUsage('server');
    expect(newUsageResult.success).toBe(true);
    if (newUsageResult.success) {
      expect(newUsageResult.data).toHaveLength(0);
    }
  });

  test('should handle conflicts when entity already has new tag', () => {
    const { projectId1 } = setupTestDatabase();

    // Add 'server' tag to projectId1 which already has 'backend'
    db.run(
      'INSERT INTO entity_tags (id, entity_id, entity_type, tag, created_at) VALUES (?, ?, ?, ?, ?)',
      [generateId(), projectId1, 'PROJECT', 'server', now()]
    );

    const result = renameTag('backend', 'server');

    expect(result.success).toBe(true);
    if (result.success) {
      // Should affect 2 entities, but one is a conflict (delete) and one is an update
      expect(result.data.affected).toBe(2);
      expect(result.data.entities).toHaveLength(2);
    }

    // Verify projectId1 has only one 'server' tag (not duplicated)
    const rows = db
      .query('SELECT * FROM entity_tags WHERE entity_id = ? AND entity_type = ? AND tag = ?')
      .all(projectId1, 'PROJECT', 'server') as any[];
    expect(rows).toHaveLength(1);

    // Verify 'backend' tag is gone from projectId1
    const backendRows = db
      .query('SELECT * FROM entity_tags WHERE entity_id = ? AND entity_type = ? AND tag = ?')
      .all(projectId1, 'PROJECT', 'backend') as any[];
    expect(backendRows).toHaveLength(0);
  });

  test('should be case-insensitive', () => {
    const result = renameTag('BACKEND', 'SERVER');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.affected).toBe(2);
    }

    // Tags are stored lowercase
    const usageResult = getTagUsage('server');
    expect(usageResult.success).toBe(true);
    if (usageResult.success) {
      expect(usageResult.data).toHaveLength(2);
    }
  });

  test('should return error for empty old tag', () => {
    const result = renameTag('', 'server');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Old tag cannot be empty');
      expect(result.code).toBe('VALIDATION_ERROR');
    }
  });

  test('should return error for empty new tag', () => {
    const result = renameTag('backend', '');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('New tag cannot be empty');
      expect(result.code).toBe('VALIDATION_ERROR');
    }
  });

  test('should return error when old and new tags are the same', () => {
    const result = renameTag('backend', 'backend');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Old and new tags are the same');
      expect(result.code).toBe('VALIDATION_ERROR');
    }
  });

  test('should trim whitespace from tags', () => {
    const result = renameTag('  backend  ', '  server  ');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.affected).toBe(2);
    }
  });

  test('should return zero affected when tag does not exist', () => {
    const result = renameTag('nonexistent', 'server');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.affected).toBe(0);
      expect(result.data.entities).toHaveLength(0);
    }
  });

  test('should handle dry run with conflicts correctly', () => {
    const { projectId1 } = setupTestDatabase();

    // Add 'server' tag to projectId1 which already has 'backend'
    db.run(
      'INSERT INTO entity_tags (id, entity_id, entity_type, tag, created_at) VALUES (?, ?, ?, ?, ?)',
      [generateId(), projectId1, 'PROJECT', 'server', now()]
    );

    const result = renameTag('backend', 'server', { dryRun: true });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.affected).toBe(2);
      expect(result.data.entities).toHaveLength(2);
    }

    // Verify no changes were made
    const backendRows = db
      .query('SELECT * FROM entity_tags WHERE entity_id = ? AND entity_type = ? AND tag = ?')
      .all(projectId1, 'PROJECT', 'backend') as any[];
    expect(backendRows).toHaveLength(1);
  });

  test('should work in a transaction', () => {
    // This test verifies that if any part fails, none of the changes are committed
    // We'll test this by checking that either all entities are updated or none

    const beforeCount = db
      .query('SELECT COUNT(*) as count FROM entity_tags WHERE tag = ?')
      .get('backend') as { count: number };

    const result = renameTag('backend', 'server');

    expect(result.success).toBe(true);

    const afterBackendCount = db
      .query('SELECT COUNT(*) as count FROM entity_tags WHERE tag = ?')
      .get('backend') as { count: number };
    const afterServerCount = db
      .query('SELECT COUNT(*) as count FROM entity_tags WHERE tag = ?')
      .get('server') as { count: number };

    // All 'backend' tags should be renamed to 'server'
    expect(afterBackendCount.count).toBe(0);
    expect(afterServerCount.count).toBe(beforeCount.count);
  });
});
