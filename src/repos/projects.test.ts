import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { db } from '../db/client';
import { ProjectStatus } from '../domain/types';
import {
  createProject,
  getProject,
  updateProject,
  deleteProject,
  searchProjects,
  getProjectOverview
} from './projects';

// Setup test database
beforeEach(() => {
  // Clean up tables before each test
  db.run('DELETE FROM entity_tags');
  db.run('DELETE FROM tasks');
  db.run('DELETE FROM features');
  db.run('DELETE FROM projects');
});

afterAll(() => {
  // Final cleanup
  db.run('DELETE FROM entity_tags');
  db.run('DELETE FROM tasks');
  db.run('DELETE FROM features');
  db.run('DELETE FROM projects');
});

describe('createProject', () => {
  it('should create a project with minimal required fields', () => {
    const result = createProject({
      name: 'Test Project',
      summary: 'A test project summary'
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBeDefined();
      expect(result.data.name).toBe('Test Project');
      expect(result.data.summary).toBe('A test project summary');
      expect(result.data.status).toBe(ProjectStatus.PLANNING);
      expect(result.data.version).toBe(1);
      expect(result.data.createdAt).toBeInstanceOf(Date);
      expect(result.data.modifiedAt).toBeInstanceOf(Date);
    }
  });

  it('should create a project with all optional fields', () => {
    const result = createProject({
      name: 'Full Project',
      summary: 'A complete project',
      description: 'Detailed description here',
      status: ProjectStatus.IN_DEVELOPMENT,
      tags: ['backend', 'api']
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe('Detailed description here');
      expect(result.data.status).toBe(ProjectStatus.IN_DEVELOPMENT);
      // Tags can be in any order since they're stored in a set-like structure
      expect(result.data.tags).toContain('backend');
      expect(result.data.tags).toContain('api');
      expect(result.data.tags?.length).toBe(2);
    }
  });

  it('should reject empty project name', () => {
    const result = createProject({
      name: '   ',
      summary: 'Test summary'
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.error).toContain('name cannot be empty');
    }
  });

  it('should reject empty project summary', () => {
    const result = createProject({
      name: 'Test Project',
      summary: '   '
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.error).toContain('summary cannot be empty');
    }
  });

  it('should normalize and deduplicate tags', () => {
    const result = createProject({
      name: 'Tagged Project',
      summary: 'Project with tags',
      tags: ['Backend', 'BACKEND', 'api', 'API']
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // Tags should be normalized to lowercase and deduplicated
      expect(result.data.tags).toBeDefined();
      expect(result.data.tags?.length).toBe(2);
      expect(result.data.tags).toContain('backend');
      expect(result.data.tags).toContain('api');
    }
  });

  it('should build search vector from name, summary, and description', () => {
    const result = createProject({
      name: 'Searchable Project',
      summary: 'This is searchable',
      description: 'With detailed information'
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.searchVector).toBeDefined();
      expect(result.data.searchVector).toContain('searchable');
    }
  });
});

describe('getProject', () => {
  it('should retrieve an existing project by id', () => {
    const created = createProject({
      name: 'Retrievable Project',
      summary: 'Can be retrieved'
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = getProject(created.data.id);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(created.data.id);
      expect(result.data.name).toBe('Retrievable Project');
      expect(result.data.summary).toBe('Can be retrieved');
    }
  });

  it('should return error for non-existent project', () => {
    const result = getProject('non-existent-id-12345');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
      expect(result.error).toContain('Project not found');
    }
  });

  it('should load tags with project', () => {
    const created = createProject({
      name: 'Tagged Project',
      summary: 'Has tags',
      tags: ['tag1', 'tag2']
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = getProject(created.data.id);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toContain('tag1');
      expect(result.data.tags).toContain('tag2');
    }
  });
});

describe('updateProject', () => {
  it('should update project name', () => {
    const created = createProject({
      name: 'Original Name',
      summary: 'Original summary'
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateProject(created.data.id, {
      name: 'Updated Name',
      version: 1
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Updated Name');
      expect(result.data.summary).toBe('Original summary');
      expect(result.data.version).toBe(2);
    }
  });

  it('should update project summary', () => {
    const created = createProject({
      name: 'Test Project',
      summary: 'Original summary'
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateProject(created.data.id, {
      summary: 'Updated summary',
      version: 1
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.summary).toBe('Updated summary');
      expect(result.data.version).toBe(2);
    }
  });

  it('should update project description', () => {
    const created = createProject({
      name: 'Test Project',
      summary: 'Test summary'
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateProject(created.data.id, {
      description: 'New description',
      version: 1
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe('New description');
      expect(result.data.version).toBe(2);
    }
  });

  it('should update project status', () => {
    const created = createProject({
      name: 'Test Project',
      summary: 'Test summary'
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateProject(created.data.id, {
      status: ProjectStatus.IN_DEVELOPMENT,
      version: 1
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe(ProjectStatus.IN_DEVELOPMENT);
      expect(result.data.version).toBe(2);
    }
  });

  it('should update project tags', () => {
    const created = createProject({
      name: 'Test Project',
      summary: 'Test summary',
      tags: ['old-tag']
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateProject(created.data.id, {
      tags: ['new-tag1', 'new-tag2'],
      version: 1
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toContain('new-tag1');
      expect(result.data.tags).toContain('new-tag2');
      expect(result.data.tags).not.toContain('old-tag');
    }
  });

  it('should reject version conflict (optimistic locking)', () => {
    const created = createProject({
      name: 'Test Project',
      summary: 'Test summary'
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateProject(created.data.id, {
      name: 'Updated Name',
      version: 999 // Wrong version
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VERSION_CONFLICT');
      expect(result.error).toContain('Version mismatch');
    }
  });

  it('should reject empty name', () => {
    const created = createProject({
      name: 'Test Project',
      summary: 'Test summary'
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateProject(created.data.id, {
      name: '   ',
      version: 1
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
    }
  });

  it('should reject empty summary', () => {
    const created = createProject({
      name: 'Test Project',
      summary: 'Test summary'
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateProject(created.data.id, {
      summary: '   ',
      version: 1
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
    }
  });

  it('should return error for non-existent project', () => {
    const result = updateProject('non-existent-id', {
      name: 'New Name',
      version: 1
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
    }
  });

  it('should update modifiedAt timestamp', () => {
    const created = createProject({
      name: 'Test Project',
      summary: 'Test summary'
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const originalModifiedAt = created.data.modifiedAt;

    const result = updateProject(created.data.id, {
      name: 'Updated Name',
      version: 1
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // On fast systems, the update can happen in the same millisecond
      // Check that the timestamp is at least the same or newer
      expect(result.data.modifiedAt.getTime()).toBeGreaterThanOrEqual(originalModifiedAt.getTime());
    }
  });

  it('should rebuild search vector on update', () => {
    const created = createProject({
      name: 'Original',
      summary: 'Original summary'
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = updateProject(created.data.id, {
      name: 'Updated Searchable',
      version: 1
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.searchVector).toContain('updated');
      expect(result.data.searchVector).toContain('searchable');
    }
  });
});

describe('deleteProject', () => {
  it('should delete an existing project', () => {
    const created = createProject({
      name: 'To Delete',
      summary: 'Will be deleted'
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = deleteProject(created.data.id);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(true);
    }

    // Verify it's actually deleted
    const getResult = getProject(created.data.id);
    expect(getResult.success).toBe(false);
  });

  it('should delete project tags when deleting project', () => {
    const created = createProject({
      name: 'Tagged Project',
      summary: 'Has tags',
      tags: ['tag1', 'tag2']
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = deleteProject(created.data.id);

    expect(result.success).toBe(true);

    // Verify tags are deleted
    const rows = db.query('SELECT * FROM entity_tags WHERE entity_id = ? AND entity_type = ?')
      .all(created.data.id, 'PROJECT');
    expect(rows.length).toBe(0);
  });

  it('should return error for non-existent project', () => {
    const result = deleteProject('non-existent-id');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
    }
  });
});

describe('searchProjects', () => {
  it('should return all projects when no filters', () => {
    createProject({ name: 'Project 1', summary: 'Summary 1' });
    createProject({ name: 'Project 2', summary: 'Summary 2' });

    const result = searchProjects({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(2);
    }
  });

  it('should search by text query', () => {
    createProject({ name: 'Unique Project', summary: 'Summary' });
    createProject({ name: 'Another Project', summary: 'Summary' });

    const result = searchProjects({ query: 'unique' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(1);
      expect(result.data[0]!.name).toBe('Unique Project');
    }
  });

  it('should filter by status', () => {
    createProject({ name: 'Planning Project', summary: 'Summary', status: ProjectStatus.PLANNING });
    createProject({ name: 'Dev Project', summary: 'Summary', status: ProjectStatus.IN_DEVELOPMENT });

    const result = searchProjects({ status: ProjectStatus.IN_DEVELOPMENT });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(1);
      expect(result.data[0]!.status).toBe(ProjectStatus.IN_DEVELOPMENT);
    }
  });

  it('should filter by multiple statuses', () => {
    createProject({ name: 'Planning', summary: 'Summary', status: ProjectStatus.PLANNING });
    createProject({ name: 'In Dev', summary: 'Summary', status: ProjectStatus.IN_DEVELOPMENT });
    createProject({ name: 'Completed', summary: 'Summary', status: ProjectStatus.COMPLETED });

    const result = searchProjects({ status: 'PLANNING,IN_DEVELOPMENT' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(2);
    }
  });

  it('should filter by negated status', () => {
    createProject({ name: 'Active 1', summary: 'Summary', status: ProjectStatus.PLANNING });
    createProject({ name: 'Active 2', summary: 'Summary', status: ProjectStatus.IN_DEVELOPMENT });
    createProject({ name: 'Done', summary: 'Summary', status: ProjectStatus.COMPLETED });

    const result = searchProjects({ status: '!COMPLETED' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(2);
      expect(result.data.every(p => p.status !== ProjectStatus.COMPLETED)).toBe(true);
    }
  });

  it('should filter by tags', () => {
    createProject({ name: 'Backend Project', summary: 'Summary', tags: ['backend', 'api'] });
    createProject({ name: 'Frontend Project', summary: 'Summary', tags: ['frontend', 'ui'] });

    const result = searchProjects({ tags: 'backend,api' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(1);
      expect(result.data[0]!.name).toBe('Backend Project');
    }
  });

  it('should combine text query and status filter', () => {
    createProject({ name: 'Unique Active', summary: 'Summary', status: ProjectStatus.IN_DEVELOPMENT });
    createProject({ name: 'Unique Done', summary: 'Summary', status: ProjectStatus.COMPLETED });
    createProject({ name: 'Other Active', summary: 'Summary', status: ProjectStatus.IN_DEVELOPMENT });

    const result = searchProjects({
      query: 'unique',
      status: ProjectStatus.IN_DEVELOPMENT
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(1);
      expect(result.data[0]!.name).toBe('Unique Active');
    }
  });

  it('should respect limit parameter', () => {
    createProject({ name: 'Project 1', summary: 'Summary' });
    createProject({ name: 'Project 2', summary: 'Summary' });
    createProject({ name: 'Project 3', summary: 'Summary' });

    const result = searchProjects({ limit: 2 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(2);
    }
  });

  it('should respect offset parameter', () => {
    createProject({ name: 'Project 1', summary: 'Summary' });
    createProject({ name: 'Project 2', summary: 'Summary' });
    createProject({ name: 'Project 3', summary: 'Summary' });

    const result = searchProjects({ limit: 1, offset: 1 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(1);
    }
  });

  it('should order results by modified_at DESC', () => {
    const first = createProject({ name: 'First', summary: 'Summary' });
    const second = createProject({ name: 'Second', summary: 'Summary' });

    const result = searchProjects({});

    expect(result.success).toBe(true);
    if (result.success && first.success && second.success) {
      // Most recently modified should be first
      expect(result.data[0]!.id).toBe(second.data.id);
      expect(result.data[1]!.id).toBe(first.data.id);
    }
  });

  it('should return empty array when no matches', () => {
    createProject({ name: 'Project', summary: 'Summary' });

    const result = searchProjects({ query: 'nonexistent' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(0);
    }
  });
});

describe('getProjectOverview', () => {
  it('should return project with empty task counts', () => {
    const created = createProject({
      name: 'Overview Project',
      summary: 'For overview'
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = getProjectOverview(created.data.id);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project.id).toBe(created.data.id);
      expect(result.data.taskCounts.total).toBe(0);
      expect(result.data.taskCounts.byStatus).toEqual({});
    }
  });

  it('should return error for non-existent project', () => {
    const result = getProjectOverview('non-existent-id');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
    }
  });
});
