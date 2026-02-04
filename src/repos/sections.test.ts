import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { db } from '../db/client';
import { ContentFormat, EntityType } from '../domain/types';
import {
  addSection,
  deleteSection,
} from './sections';

// Setup test database
beforeEach(() => {
  // Clean up tables before each test
  db.run('DELETE FROM sections');
  db.run('DELETE FROM tasks');
  db.run('DELETE FROM features');
  db.run('DELETE FROM projects');
});

afterAll(() => {
  // Final cleanup
  db.run('DELETE FROM sections');
  db.run('DELETE FROM tasks');
  db.run('DELETE FROM features');
  db.run('DELETE FROM projects');
});

describe('deleteSection', () => {
  it('should delete an existing section and return true', () => {
    // First create a section
    const createResult = addSection({
      entityType: EntityType.PROJECT,
      entityId: 'test-project-id',
      title: 'Test Section',
      usageDescription: 'A test section',
      content: 'Test content',
      contentFormat: ContentFormat.MARKDOWN
    });

    expect(createResult.success).toBe(true);
    if (!createResult.success) return;

    const sectionId = createResult.data.id;

    // Now delete it
    const deleteResult = deleteSection(sectionId);

    expect(deleteResult.success).toBe(true);
    if (deleteResult.success) {
      expect(deleteResult.data).toBe(true);
    }
  });

  it('should return NOT_FOUND error when deleting non-existent section', () => {
    const nonExistentId = 'non-existent-section-id';

    const deleteResult = deleteSection(nonExistentId);

    expect(deleteResult.success).toBe(false);
    if (!deleteResult.success) {
      expect(deleteResult.code).toBe('NOT_FOUND');
      expect(deleteResult.error).toContain('Section not found');
      expect(deleteResult.error).toContain(nonExistentId);
    }
  });

  it('should return NOT_FOUND error when deleting already deleted section', () => {
    // First create a section
    const createResult = addSection({
      entityType: EntityType.PROJECT,
      entityId: 'test-project-id',
      title: 'Test Section',
      usageDescription: 'A test section',
      content: 'Test content',
      contentFormat: ContentFormat.MARKDOWN
    });

    expect(createResult.success).toBe(true);
    if (!createResult.success) return;

    const sectionId = createResult.data.id;

    // Delete it once
    const firstDeleteResult = deleteSection(sectionId);
    expect(firstDeleteResult.success).toBe(true);

    // Try to delete it again
    const secondDeleteResult = deleteSection(sectionId);

    expect(secondDeleteResult.success).toBe(false);
    if (!secondDeleteResult.success) {
      expect(secondDeleteResult.code).toBe('NOT_FOUND');
      expect(secondDeleteResult.error).toContain('Section not found');
    }
  });
});
