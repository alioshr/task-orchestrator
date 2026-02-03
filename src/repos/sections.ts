import {
  db,
  generateId,
  now,
  queryOne,
  queryAll,
  execute,
  ok,
  err,
  toDate,
} from './base';
import type { Result, Section } from '../domain/types';
import { ContentFormat, EntityType, NotFoundError, ValidationError } from '../domain/types';

// ============================================================================
// Type Definitions
// ============================================================================

interface SectionRow {
  id: string;
  entity_type: string;
  entity_id: string;
  title: string;
  usage_description: string;
  content: string;
  content_format: string;
  ordinal: number;
  tags: string;
  version: number;
  created_at: string;
  modified_at: string;
}

interface AddSectionParams {
  entityType: string;
  entityId: string;
  title: string;
  usageDescription: string;
  content: string;
  contentFormat?: string;
  ordinal?: number;
  tags?: string;
}

interface GetSectionsParams {
  includeContent?: boolean;
  tags?: string;
  sectionIds?: string[];
}

interface UpdateSectionParams {
  title?: string;
  usageDescription?: string;
  content?: string;
  contentFormat?: string;
  tags?: string;
  version: number;
}

interface BulkCreateSectionParams {
  entityType: string;
  entityId: string;
  title: string;
  usageDescription: string;
  content: string;
  contentFormat?: string;
  tags?: string;
}

// ============================================================================
// Mapper Functions
// ============================================================================

function rowToSection(row: SectionRow): Section {
  return {
    id: row.id,
    entityType: row.entity_type as EntityType,
    entityId: row.entity_id,
    title: row.title,
    usageDescription: row.usage_description,
    content: row.content,
    contentFormat: row.content_format as ContentFormat,
    ordinal: row.ordinal,
    tags: row.tags,
    version: row.version,
    createdAt: toDate(row.created_at),
    modifiedAt: toDate(row.modified_at),
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function getNextOrdinal(entityId: string, entityType: string): number {
  const result = queryOne<{ max_ordinal: number | null }>(
    'SELECT MAX(ordinal) as max_ordinal FROM sections WHERE entity_id = ? AND entity_type = ?',
    [entityId, entityType]
  );
  return (result?.max_ordinal ?? -1) + 1;
}

function validateContentFormat(format: string): boolean {
  return Object.values(ContentFormat).includes(format as ContentFormat);
}

// ============================================================================
// Repository Functions
// ============================================================================

/**
 * Add a new section to an entity
 */
export function addSection(params: AddSectionParams): Result<Section> {
  try {
    // Validate content format if provided
    const contentFormat = params.contentFormat ?? ContentFormat.MARKDOWN;
    if (!validateContentFormat(contentFormat)) {
      return err(`Invalid content format: ${contentFormat}`);
    }

    // Get ordinal
    const ordinal = params.ordinal ?? getNextOrdinal(params.entityId, params.entityType);

    // Check for ordinal conflict
    const existing = queryOne<{ id: string }>(
      'SELECT id FROM sections WHERE entity_type = ? AND entity_id = ? AND ordinal = ?',
      [params.entityType, params.entityId, ordinal]
    );

    if (existing) {
      return err(`Section with ordinal ${ordinal} already exists for this entity`, 'CONFLICT');
    }

    const id = generateId();
    const timestamp = now();
    const tags = params.tags ?? '';

    execute(
      `INSERT INTO sections (
        id, entity_type, entity_id, title, usage_description,
        content, content_format, ordinal, tags, version,
        created_at, modified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        id,
        params.entityType,
        params.entityId,
        params.title,
        params.usageDescription,
        params.content,
        contentFormat,
        ordinal,
        tags,
        timestamp,
        timestamp,
      ]
    );

    const row = queryOne<SectionRow>('SELECT * FROM sections WHERE id = ?', [id]);
    if (!row) {
      return err('Failed to create section');
    }

    return ok(rowToSection(row));
  } catch (error) {
    return err(`Failed to add section: ${error}`);
  }
}

/**
 * Get sections for an entity
 */
export function getSections(
  entityId: string,
  entityType: string,
  params?: GetSectionsParams
): Result<Section[]> {
  try {
    let sql = 'SELECT * FROM sections WHERE entity_id = ? AND entity_type = ?';
    const sqlParams: any[] = [entityId, entityType];

    // Filter by tags if provided
    if (params?.tags) {
      const tagList = params.tags.split(',').map(t => t.trim());
      const tagConditions = tagList.map(() => 'tags LIKE ?').join(' OR ');
      sql += ` AND (${tagConditions})`;
      tagList.forEach(tag => sqlParams.push(`%${tag}%`));
    }

    // Filter by section IDs if provided
    if (params?.sectionIds && params.sectionIds.length > 0) {
      const placeholders = params.sectionIds.map(() => '?').join(',');
      sql += ` AND id IN (${placeholders})`;
      sqlParams.push(...params.sectionIds);
    }

    sql += ' ORDER BY ordinal ASC';

    const rows = queryAll<SectionRow>(sql, sqlParams);

    // If includeContent is false, clear content field for token savings
    if (params?.includeContent === false) {
      const sections = rows.map(row => rowToSection({ ...row, content: '' }));
      return ok(sections);
    }

    const sections = rows.map(rowToSection);
    return ok(sections);
  } catch (error) {
    return err(`Failed to get sections: ${error}`);
  }
}

/**
 * Update a section
 */
export function updateSection(id: string, params: UpdateSectionParams): Result<Section> {
  try {
    // Validate version
    const existing = queryOne<SectionRow>('SELECT * FROM sections WHERE id = ?', [id]);
    if (!existing) {
      return err(`Section not found: ${id}`, 'NOT_FOUND');
    }

    if (existing.version !== params.version) {
      return err(
        `Version mismatch: expected ${existing.version}, got ${params.version}`,
        'VERSION_CONFLICT'
      );
    }

    // Validate content format if provided
    if (params.contentFormat && !validateContentFormat(params.contentFormat)) {
      return err(`Invalid content format: ${params.contentFormat}`);
    }

    // Build update query dynamically
    const updates: string[] = [];
    const sqlParams: any[] = [];

    if (params.title !== undefined) {
      updates.push('title = ?');
      sqlParams.push(params.title);
    }
    if (params.usageDescription !== undefined) {
      updates.push('usage_description = ?');
      sqlParams.push(params.usageDescription);
    }
    if (params.content !== undefined) {
      updates.push('content = ?');
      sqlParams.push(params.content);
    }
    if (params.contentFormat !== undefined) {
      updates.push('content_format = ?');
      sqlParams.push(params.contentFormat);
    }
    if (params.tags !== undefined) {
      updates.push('tags = ?');
      sqlParams.push(params.tags);
    }

    if (updates.length === 0) {
      return err('No fields to update');
    }

    // Always update version and modified_at
    updates.push('version = version + 1');
    updates.push('modified_at = ?');
    sqlParams.push(now());

    // Add id for WHERE clause
    sqlParams.push(id);

    const sql = `UPDATE sections SET ${updates.join(', ')} WHERE id = ?`;
    const changes = execute(sql, sqlParams);

    if (changes === 0) {
      return err(`Section not found: ${id}`, 'NOT_FOUND');
    }

    const updated = queryOne<SectionRow>('SELECT * FROM sections WHERE id = ?', [id]);
    if (!updated) {
      return err('Failed to retrieve updated section');
    }

    return ok(rowToSection(updated));
  } catch (error) {
    return err(`Failed to update section: ${error}`);
  }
}

/**
 * Update only the text content of a section
 */
export function updateSectionText(id: string, content: string, version: number): Result<Section> {
  try {
    // Validate version
    const existing = queryOne<SectionRow>('SELECT * FROM sections WHERE id = ?', [id]);
    if (!existing) {
      return err(`Section not found: ${id}`, 'NOT_FOUND');
    }

    if (existing.version !== version) {
      return err(
        `Version mismatch: expected ${existing.version}, got ${version}`,
        'VERSION_CONFLICT'
      );
    }

    const changes = execute(
      'UPDATE sections SET content = ?, version = version + 1, modified_at = ? WHERE id = ?',
      [content, now(), id]
    );

    if (changes === 0) {
      return err(`Section not found: ${id}`, 'NOT_FOUND');
    }

    const updated = queryOne<SectionRow>('SELECT * FROM sections WHERE id = ?', [id]);
    if (!updated) {
      return err('Failed to retrieve updated section');
    }

    return ok(rowToSection(updated));
  } catch (error) {
    return err(`Failed to update section text: ${error}`);
  }
}

/**
 * Delete a section
 */
export function deleteSection(id: string): Result<boolean> {
  try {
    const changes = execute('DELETE FROM sections WHERE id = ?', [id]);
    return ok(changes > 0);
  } catch (error) {
    return err(`Failed to delete section: ${error}`);
  }
}

/**
 * Reorder sections for an entity
 */
export function reorderSections(
  entityId: string,
  entityType: string,
  orderedIds: string[]
): Result<boolean> {
  try {
    // Use transaction for atomic updates
    db.run('BEGIN TRANSACTION');

    try {
      for (let i = 0; i < orderedIds.length; i++) {
        const changes = execute(
          'UPDATE sections SET ordinal = ?, modified_at = ? WHERE id = ? AND entity_id = ? AND entity_type = ?',
          [i, now(), orderedIds[i], entityId, entityType]
        );

        if (changes === 0) {
          throw new Error(`Section not found or does not belong to entity: ${orderedIds[i]}`);
        }
      }

      db.run('COMMIT');
      return ok(true);
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
  } catch (error) {
    return err(`Failed to reorder sections: ${error}`);
  }
}

/**
 * Bulk create sections
 */
export function bulkCreateSections(
  sections: BulkCreateSectionParams[]
): Result<Section[]> {
  try {
    if (sections.length === 0) {
      return ok([]);
    }

    // Use transaction for atomic bulk insert
    db.run('BEGIN TRANSACTION');

    try {
      const created: Section[] = [];

      // Group by entity to get proper ordinals
      const entityMap = new Map<string, number>();

      for (const section of sections) {
        const entityKey = `${section.entityType}:${section.entityId}`;

        // Get or calculate starting ordinal for this entity
        if (!entityMap.has(entityKey)) {
          const startOrdinal = getNextOrdinal(section.entityId, section.entityType);
          entityMap.set(entityKey, startOrdinal);
        }

        const ordinal = entityMap.get(entityKey)!;
        entityMap.set(entityKey, ordinal + 1);

        const contentFormat = section.contentFormat ?? ContentFormat.MARKDOWN;
        if (!validateContentFormat(contentFormat)) {
          throw new Error(`Invalid content format: ${contentFormat}`);
        }

        const id = generateId();
        const timestamp = now();
        const tags = section.tags ?? '';

        execute(
          `INSERT INTO sections (
            id, entity_type, entity_id, title, usage_description,
            content, content_format, ordinal, tags, version,
            created_at, modified_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [
            id,
            section.entityType,
            section.entityId,
            section.title,
            section.usageDescription,
            section.content,
            contentFormat,
            ordinal,
            tags,
            timestamp,
            timestamp,
          ]
        );

        const row = queryOne<SectionRow>('SELECT * FROM sections WHERE id = ?', [id]);
        if (!row) {
          throw new Error('Failed to retrieve created section');
        }

        created.push(rowToSection(row));
      }

      db.run('COMMIT');
      return ok(created);
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
  } catch (error) {
    return err(`Failed to bulk create sections: ${error}`);
  }
}

/**
 * Bulk delete sections
 */
export function bulkDeleteSections(ids: string[]): Result<number> {
  try {
    if (ids.length === 0) {
      return ok(0);
    }

    // Use transaction for atomic bulk delete
    db.run('BEGIN TRANSACTION');

    try {
      const placeholders = ids.map(() => '?').join(',');
      const changes = execute(`DELETE FROM sections WHERE id IN (${placeholders})`, ids);

      db.run('COMMIT');
      return ok(changes);
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
  } catch (error) {
    return err(`Failed to bulk delete sections: ${error}`);
  }
}
