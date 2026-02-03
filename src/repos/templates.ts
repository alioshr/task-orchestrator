import {
  db,
  generateId,
  now,
  queryOne,
  queryAll,
  execute,
  ok,
  err,
  saveTags,
  deleteTags
} from './base';
import type { Result } from '../domain/types';
import {
  Template,
  TemplateSection,
  Section,
  EntityType,
  ContentFormat,
  NotFoundError,
  ValidationError
} from '../domain/types';
import { transaction } from '../db/client';

// ============================================================================
// Internal Types (DB Row Mapping)
// ============================================================================

interface TemplateRow {
  id: string;
  name: string;
  description: string;
  target_entity_type: string;
  is_built_in: number;
  is_protected: number;
  is_enabled: number;
  created_by: string | null;
  tags: string;
  created_at: string;
  modified_at: string;
}

interface TemplateSectionRow {
  id: string;
  template_id: string;
  title: string;
  usage_description: string;
  content_sample: string;
  content_format: string;
  ordinal: number;
  is_required: number;
  tags: string;
}

// ============================================================================
// Mapping Helpers
// ============================================================================

function mapTemplateRow(row: TemplateRow): Template {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    targetEntityType: row.target_entity_type as EntityType,
    isBuiltIn: row.is_built_in === 1,
    isProtected: row.is_protected === 1,
    isEnabled: row.is_enabled === 1,
    createdBy: row.created_by || undefined,
    tags: row.tags,
    createdAt: new Date(row.created_at),
    modifiedAt: new Date(row.modified_at)
  };
}

function mapTemplateSectionRow(row: TemplateSectionRow): TemplateSection {
  return {
    id: row.id,
    templateId: row.template_id,
    title: row.title,
    usageDescription: row.usage_description,
    contentSample: row.content_sample,
    contentFormat: row.content_format as ContentFormat,
    ordinal: row.ordinal,
    isRequired: row.is_required === 1,
    tags: row.tags
  };
}

// ============================================================================
// Public API
// ============================================================================

export interface CreateTemplateParams {
  name: string;
  description: string;
  targetEntityType: string;
  isBuiltIn?: boolean;
  isProtected?: boolean;
  createdBy?: string;
  tags?: string;
}

export function createTemplate(params: CreateTemplateParams): Result<Template> {
  try {
    // Validation
    if (!params.name?.trim()) {
      throw new ValidationError('Template name is required');
    }
    if (!params.description?.trim()) {
      throw new ValidationError('Template description is required');
    }
    if (!params.targetEntityType?.trim()) {
      throw new ValidationError('Target entity type is required');
    }

    // Check for duplicate name
    const existing = queryOne<{ id: string }>(
      'SELECT id FROM templates WHERE name = ?',
      [params.name.trim()]
    );
    if (existing) {
      return err('Template with this name already exists', 'DUPLICATE_NAME');
    }

    const template = transaction(() => {
      const id = generateId();
      const timestamp = now();

      execute(
        `INSERT INTO templates (
          id, name, description, target_entity_type,
          is_built_in, is_protected, is_enabled, created_by,
          tags, created_at, modified_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          params.name.trim(),
          params.description.trim(),
          params.targetEntityType.trim(),
          params.isBuiltIn ? 1 : 0,
          params.isProtected ? 1 : 0,
          1, // is_enabled defaults to true
          params.createdBy || null,
          params.tags || '',
          timestamp,
          timestamp
        ]
      );

      const row = queryOne<TemplateRow>('SELECT * FROM templates WHERE id = ?', [id]);
      if (!row) {
        throw new Error('Failed to create template');
      }

      return mapTemplateRow(row);
    });

    return ok(template);
  } catch (error) {
    if (error instanceof ValidationError) {
      return err(error.message, 'VALIDATION_ERROR');
    }
    return err(`Failed to create template: ${(error as Error).message}`);
  }
}

export interface GetTemplateResult {
  template: Template;
  sections?: TemplateSection[];
}

export function getTemplate(id: string, includeSections = false): Result<GetTemplateResult> {
  try {
    if (!id?.trim()) {
      throw new ValidationError('Template ID is required');
    }

    const row = queryOne<TemplateRow>('SELECT * FROM templates WHERE id = ?', [id]);
    if (!row) {
      throw new NotFoundError('Template', id);
    }

    const template = mapTemplateRow(row);
    const result: GetTemplateResult = { template };

    if (includeSections) {
      const sectionRows = queryAll<TemplateSectionRow>(
        'SELECT * FROM template_sections WHERE template_id = ? ORDER BY ordinal',
        [id]
      );
      result.sections = sectionRows.map(mapTemplateSectionRow);
    }

    return ok(result);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      return err(error.message, error.name.toUpperCase());
    }
    return err(`Failed to get template: ${(error as Error).message}`);
  }
}

export interface ListTemplatesParams {
  targetEntityType?: string;
  isBuiltIn?: boolean;
  isEnabled?: boolean;
  tags?: string;
}

export function listTemplates(params?: ListTemplatesParams): Result<Template[]> {
  try {
    let sql = 'SELECT * FROM templates WHERE 1=1';
    const sqlParams: any[] = [];

    if (params?.targetEntityType) {
      sql += ' AND target_entity_type = ?';
      sqlParams.push(params.targetEntityType);
    }

    if (params?.isBuiltIn !== undefined) {
      sql += ' AND is_built_in = ?';
      sqlParams.push(params.isBuiltIn ? 1 : 0);
    }

    if (params?.isEnabled !== undefined) {
      sql += ' AND is_enabled = ?';
      sqlParams.push(params.isEnabled ? 1 : 0);
    }

    if (params?.tags) {
      sql += ' AND tags LIKE ?';
      sqlParams.push(`%${params.tags}%`);
    }

    sql += ' ORDER BY name';

    const rows = queryAll<TemplateRow>(sql, sqlParams);
    return ok(rows.map(mapTemplateRow));
  } catch (error) {
    return err(`Failed to list templates: ${(error as Error).message}`);
  }
}

export interface UpdateTemplateParams {
  name?: string;
  description?: string;
  tags?: string;
}

export function updateTemplate(id: string, params: UpdateTemplateParams): Result<Template> {
  try {
    if (!id?.trim()) {
      throw new ValidationError('Template ID is required');
    }

    // Check if template exists and is not protected
    const existing = queryOne<{ is_protected: number }>(
      'SELECT is_protected FROM templates WHERE id = ?',
      [id]
    );
    if (!existing) {
      throw new NotFoundError('Template', id);
    }
    if (existing.is_protected === 1) {
      return err('Cannot update protected template', 'PROTECTED_TEMPLATE');
    }

    // Build update query
    const updates: string[] = [];
    const sqlParams: any[] = [];

    if (params.name !== undefined) {
      if (!params.name.trim()) {
        throw new ValidationError('Template name cannot be empty');
      }
      // Check for duplicate name (excluding current template)
      const duplicate = queryOne<{ id: string }>(
        'SELECT id FROM templates WHERE name = ? AND id != ?',
        [params.name.trim(), id]
      );
      if (duplicate) {
        return err('Template with this name already exists', 'DUPLICATE_NAME');
      }
      updates.push('name = ?');
      sqlParams.push(params.name.trim());
    }

    if (params.description !== undefined) {
      if (!params.description.trim()) {
        throw new ValidationError('Template description cannot be empty');
      }
      updates.push('description = ?');
      sqlParams.push(params.description.trim());
    }

    if (params.tags !== undefined) {
      updates.push('tags = ?');
      sqlParams.push(params.tags);
    }

    if (updates.length === 0) {
      // Nothing to update, just return current template
      const result = getTemplate(id);
      if (!result.success) return result as Result<Template>;
      return ok(result.data.template);
    }

    updates.push('modified_at = ?');
    sqlParams.push(now());
    sqlParams.push(id);

    const template = transaction(() => {
      execute(
        `UPDATE templates SET ${updates.join(', ')} WHERE id = ?`,
        sqlParams
      );

      const row = queryOne<TemplateRow>('SELECT * FROM templates WHERE id = ?', [id]);
      if (!row) {
        throw new Error('Failed to update template');
      }

      return mapTemplateRow(row);
    });

    return ok(template);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      return err(error.message, error.name.toUpperCase());
    }
    return err(`Failed to update template: ${(error as Error).message}`);
  }
}

export function deleteTemplate(id: string): Result<boolean> {
  try {
    if (!id?.trim()) {
      throw new ValidationError('Template ID is required');
    }

    // Check if template exists and is not protected
    const existing = queryOne<{ is_protected: number }>(
      'SELECT is_protected FROM templates WHERE id = ?',
      [id]
    );
    if (!existing) {
      throw new NotFoundError('Template', id);
    }
    if (existing.is_protected === 1) {
      return err('Cannot delete protected template', 'PROTECTED_TEMPLATE');
    }

    transaction(() => {
      // Delete template sections first (foreign key)
      execute('DELETE FROM template_sections WHERE template_id = ?', [id]);
      // Delete template
      execute('DELETE FROM templates WHERE id = ?', [id]);
    });

    return ok(true);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      return err(error.message, error.name.toUpperCase());
    }
    return err(`Failed to delete template: ${(error as Error).message}`);
  }
}

export function enableTemplate(id: string): Result<Template> {
  try {
    if (!id?.trim()) {
      throw new ValidationError('Template ID is required');
    }

    const existing = queryOne<{ id: string }>(
      'SELECT id FROM templates WHERE id = ?',
      [id]
    );
    if (!existing) {
      throw new NotFoundError('Template', id);
    }

    const template = transaction(() => {
      execute(
        'UPDATE templates SET is_enabled = ?, modified_at = ? WHERE id = ?',
        [1, now(), id]
      );

      const row = queryOne<TemplateRow>('SELECT * FROM templates WHERE id = ?', [id]);
      if (!row) {
        throw new Error('Failed to enable template');
      }

      return mapTemplateRow(row);
    });

    return ok(template);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      return err(error.message, error.name.toUpperCase());
    }
    return err(`Failed to enable template: ${(error as Error).message}`);
  }
}

export function disableTemplate(id: string): Result<Template> {
  try {
    if (!id?.trim()) {
      throw new ValidationError('Template ID is required');
    }

    const existing = queryOne<{ id: string }>(
      'SELECT id FROM templates WHERE id = ?',
      [id]
    );
    if (!existing) {
      throw new NotFoundError('Template', id);
    }

    const template = transaction(() => {
      execute(
        'UPDATE templates SET is_enabled = ?, modified_at = ? WHERE id = ?',
        [0, now(), id]
      );

      const row = queryOne<TemplateRow>('SELECT * FROM templates WHERE id = ?', [id]);
      if (!row) {
        throw new Error('Failed to disable template');
      }

      return mapTemplateRow(row);
    });

    return ok(template);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      return err(error.message, error.name.toUpperCase());
    }
    return err(`Failed to disable template: ${(error as Error).message}`);
  }
}

export interface AddTemplateSectionParams {
  templateId: string;
  title: string;
  usageDescription: string;
  contentSample: string;
  contentFormat?: string;
  isRequired?: boolean;
  tags?: string;
  ordinal?: number;
}

export function addTemplateSection(params: AddTemplateSectionParams): Result<TemplateSection> {
  try {
    // Validation
    if (!params.templateId?.trim()) {
      throw new ValidationError('Template ID is required');
    }
    if (!params.title?.trim()) {
      throw new ValidationError('Section title is required');
    }
    if (!params.usageDescription?.trim()) {
      throw new ValidationError('Section usage description is required');
    }
    if (!params.contentSample?.trim()) {
      throw new ValidationError('Section content sample is required');
    }

    // Check template exists
    const template = queryOne<{ id: string }>(
      'SELECT id FROM templates WHERE id = ?',
      [params.templateId]
    );
    if (!template) {
      throw new NotFoundError('Template', params.templateId);
    }

    const section = transaction(() => {
      const id = generateId();

      // Auto-calculate ordinal if not provided
      let ordinal = params.ordinal;
      if (ordinal === undefined) {
        const maxOrdinal = queryOne<{ max_ordinal: number | null }>(
          'SELECT MAX(ordinal) as max_ordinal FROM template_sections WHERE template_id = ?',
          [params.templateId]
        );
        ordinal = (maxOrdinal?.max_ordinal ?? -1) + 1;
      }

      execute(
        `INSERT INTO template_sections (
          id, template_id, title, usage_description,
          content_sample, content_format, ordinal,
          is_required, tags
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          params.templateId,
          params.title.trim(),
          params.usageDescription.trim(),
          params.contentSample.trim(),
          params.contentFormat || 'MARKDOWN',
          ordinal,
          params.isRequired ? 1 : 0,
          params.tags || ''
        ]
      );

      const row = queryOne<TemplateSectionRow>(
        'SELECT * FROM template_sections WHERE id = ?',
        [id]
      );
      if (!row) {
        throw new Error('Failed to create template section');
      }

      return mapTemplateSectionRow(row);
    });

    return ok(section);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      return err(error.message, error.name.toUpperCase());
    }
    return err(`Failed to add template section: ${(error as Error).message}`);
  }
}

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

function mapSectionRow(row: SectionRow): Section {
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
    createdAt: new Date(row.created_at),
    modifiedAt: new Date(row.modified_at)
  };
}

export function applyTemplate(
  templateId: string,
  entityType: string,
  entityId: string
): Result<Section[]> {
  try {
    // Validation
    if (!templateId?.trim()) {
      throw new ValidationError('Template ID is required');
    }
    if (!entityType?.trim()) {
      throw new ValidationError('Entity type is required');
    }
    if (!entityId?.trim()) {
      throw new ValidationError('Entity ID is required');
    }

    // Get template with sections
    const templateResult = getTemplate(templateId, true);
    if (!templateResult.success) {
      return templateResult as Result<Section[]>;
    }

    const { template, sections: templateSections } = templateResult.data;

    // Validate template is enabled
    if (!template.isEnabled) {
      return err('Cannot apply disabled template', 'TEMPLATE_DISABLED');
    }

    // Validate entity type matches
    if (template.targetEntityType !== entityType) {
      return err(
        `Template target entity type (${template.targetEntityType}) does not match provided entity type (${entityType})`,
        'ENTITY_TYPE_MISMATCH'
      );
    }

    if (!templateSections || templateSections.length === 0) {
      return ok([]);
    }

    const sections = transaction(() => {
      const createdSections: Section[] = [];
      const timestamp = now();

      for (const templateSection of templateSections) {
        const id = generateId();

        execute(
          `INSERT INTO sections (
            id, entity_type, entity_id, title,
            usage_description, content, content_format,
            ordinal, tags, version, created_at, modified_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            entityType,
            entityId,
            templateSection.title,
            templateSection.usageDescription,
            templateSection.contentSample,
            templateSection.contentFormat,
            templateSection.ordinal,
            templateSection.tags,
            1,
            timestamp,
            timestamp
          ]
        );

        const row = queryOne<SectionRow>('SELECT * FROM sections WHERE id = ?', [id]);
        if (!row) {
          throw new Error('Failed to create section from template');
        }

        createdSections.push(mapSectionRow(row));
      }

      return createdSections;
    });

    return ok(sections);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      return err(error.message, error.name.toUpperCase());
    }
    return err(`Failed to apply template: ${(error as Error).message}`);
  }
}
