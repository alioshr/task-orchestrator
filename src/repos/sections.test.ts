import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { db } from '../db/client';
import { ContentFormat, EntityType } from '../domain/types';
import {
  addSection,
  deleteSection,
  bulkDeleteSections,
  reorderSections,
  getSections,
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

describe('bulkDeleteSections', () => {
  it('should delete multiple sections and return correct count', () => {
    // Create three sections
    const section1 = addSection({
      entityType: EntityType.PROJECT,
      entityId: 'test-project-id',
      title: 'Section 1',
      usageDescription: 'First section',
      content: 'Content 1',
      contentFormat: ContentFormat.MARKDOWN
    });

    const section2 = addSection({
      entityType: EntityType.PROJECT,
      entityId: 'test-project-id',
      title: 'Section 2',
      usageDescription: 'Second section',
      content: 'Content 2',
      contentFormat: ContentFormat.MARKDOWN
    });

    const section3 = addSection({
      entityType: EntityType.PROJECT,
      entityId: 'test-project-id',
      title: 'Section 3',
      usageDescription: 'Third section',
      content: 'Content 3',
      contentFormat: ContentFormat.MARKDOWN
    });

    expect(section1.success).toBe(true);
    expect(section2.success).toBe(true);
    expect(section3.success).toBe(true);

    if (!section1.success || !section2.success || !section3.success) return;

    // Delete all three sections
    const deleteResult = bulkDeleteSections([
      section1.data.id,
      section2.data.id,
      section3.data.id
    ]);

    expect(deleteResult.success).toBe(true);
    if (deleteResult.success) {
      expect(deleteResult.data).toBe(3);
    }
  });

  it('should handle empty array and return 0', () => {
    const deleteResult = bulkDeleteSections([]);

    expect(deleteResult.success).toBe(true);
    if (deleteResult.success) {
      expect(deleteResult.data).toBe(0);
    }
  });

  it('should work with dashless UUIDs', () => {
    // Create a section
    const section = addSection({
      entityType: EntityType.PROJECT,
      entityId: 'test-project-id',
      title: 'Test Section',
      usageDescription: 'A test section',
      content: 'Test content',
      contentFormat: ContentFormat.MARKDOWN
    });

    expect(section.success).toBe(true);
    if (!section.success) return;

    const sectionId = section.data.id; // This is dashless

    // Delete using dashless UUID
    const deleteResult = bulkDeleteSections([sectionId]);

    expect(deleteResult.success).toBe(true);
    if (deleteResult.success) {
      expect(deleteResult.data).toBe(1);
    }
  });
});

describe('reorderSections', () => {
  it('should reorder sections and update ordinals correctly', () => {
    const entityId = 'testprojectid123';
    const entityType = EntityType.PROJECT;

    // Create three sections
    const section1 = addSection({
      entityType,
      entityId,
      title: 'Section 1',
      usageDescription: 'First section',
      content: 'Content 1',
      contentFormat: ContentFormat.MARKDOWN
    });

    const section2 = addSection({
      entityType,
      entityId,
      title: 'Section 2',
      usageDescription: 'Second section',
      content: 'Content 2',
      contentFormat: ContentFormat.MARKDOWN
    });

    const section3 = addSection({
      entityType,
      entityId,
      title: 'Section 3',
      usageDescription: 'Third section',
      content: 'Content 3',
      contentFormat: ContentFormat.MARKDOWN
    });

    expect(section1.success).toBe(true);
    expect(section2.success).toBe(true);
    expect(section3.success).toBe(true);

    if (!section1.success || !section2.success || !section3.success) return;

    // Verify initial order
    const initialSections = getSections(entityId, entityType);
    expect(initialSections.success).toBe(true);
    if (initialSections.success) {
      expect(initialSections.data[0]?.title).toBe('Section 1');
      expect(initialSections.data[1]?.title).toBe('Section 2');
      expect(initialSections.data[2]?.title).toBe('Section 3');
    }

    // Reorder: 3, 1, 2 (using dashless UUIDs)
    const reorderResult = reorderSections(entityId, entityType, [
      section3.data.id,
      section1.data.id,
      section2.data.id
    ]);

    if (!reorderResult.success) {
      console.log('Reorder error:', reorderResult.error);
    }
    expect(reorderResult.success).toBe(true);

    // Verify new order
    const reorderedSections = getSections(entityId, entityType);
    expect(reorderedSections.success).toBe(true);
    if (reorderedSections.success) {
      expect(reorderedSections.data[0]?.title).toBe('Section 3');
      expect(reorderedSections.data[0]?.ordinal).toBe(0);
      expect(reorderedSections.data[1]?.title).toBe('Section 1');
      expect(reorderedSections.data[1]?.ordinal).toBe(1);
      expect(reorderedSections.data[2]?.title).toBe('Section 2');
      expect(reorderedSections.data[2]?.ordinal).toBe(2);
    }
  });

  it('should fail when section does not belong to entity', () => {
    const entityId1 = 'testprojectid111';
    const entityId2 = 'testprojectid222';
    const entityType = EntityType.PROJECT;

    // Create section for entity 1
    const section1 = addSection({
      entityType,
      entityId: entityId1,
      title: 'Section 1',
      usageDescription: 'First section',
      content: 'Content 1',
      contentFormat: ContentFormat.MARKDOWN
    });

    expect(section1.success).toBe(true);
    if (!section1.success) return;

    // Try to reorder with entity 2 (should fail)
    const reorderResult = reorderSections(entityId2, entityType, [section1.data.id]);

    expect(reorderResult.success).toBe(false);
    if (!reorderResult.success) {
      expect(reorderResult.error).toContain('Section not found or does not belong to entity');
    }
  });

  it('should fail when section ID does not exist', () => {
    const entityId = 'testprojectid123';
    const entityType = EntityType.PROJECT;

    const reorderResult = reorderSections(entityId, entityType, ['nonexistentid123']);

    expect(reorderResult.success).toBe(false);
    if (!reorderResult.success) {
      expect(reorderResult.error).toContain('Section not found or does not belong to entity');
    }
  });

  it('should handle empty orderedIds array', () => {
    const entityId = 'testprojectid123';
    const entityType = EntityType.PROJECT;

    const reorderResult = reorderSections(entityId, entityType, []);

    expect(reorderResult.success).toBe(true);
  });
});
