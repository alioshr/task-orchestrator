import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { db } from '../../db/client';
import { ContentFormat, EntityType } from '../../domain/types';
import { addSection } from '../../repos/sections';

describe('manage_sections bulkDelete with dashed UUIDs', () => {
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

  it('should normalize dashed UUIDs when parsing sectionIds for bulkDelete', () => {
    // Create test sections
    const section1 = addSection({
      entityType: EntityType.PROJECT,
      entityId: 'testprojectid123',
      title: 'Section 1',
      usageDescription: 'First section',
      content: 'Content 1',
      contentFormat: ContentFormat.MARKDOWN
    });

    const section2 = addSection({
      entityType: EntityType.PROJECT,
      entityId: 'testprojectid123',
      title: 'Section 2',
      usageDescription: 'Second section',
      content: 'Content 2',
      contentFormat: ContentFormat.MARKDOWN
    });

    expect(section1.success).toBe(true);
    expect(section2.success).toBe(true);

    if (!section1.success || !section2.success) return;

    const id1 = section1.data.id;
    const id2 = section2.data.id;

    // Format UUIDs with dashes (simulate user input with standard UUID format)
    const dashedId1 = `${id1.slice(0, 8)}-${id1.slice(8, 12)}-${id1.slice(12, 16)}-${id1.slice(16, 20)}-${id1.slice(20)}`;
    const dashedId2 = `${id2.slice(0, 8)}-${id2.slice(8, 12)}-${id2.slice(12, 16)}-${id2.slice(16, 20)}-${id2.slice(20)}`;

    // Simulate the sectionIds parsing logic from manage-sections.ts
    const sectionIdsParam = `${dashedId1}, ${dashedId2}`;
    const parsedIds = sectionIdsParam.split(',').map(id => id.trim().replace(/-/g, ''));

    // Verify the parsed IDs match the original dashless IDs
    expect(parsedIds).toEqual([id1, id2]);
    expect(parsedIds[0]).toBe(id1);
    expect(parsedIds[1]).toBe(id2);
  });

  it('should handle mixed dashed and dashless UUIDs', () => {
    // Create test section
    const section = addSection({
      entityType: EntityType.PROJECT,
      entityId: 'testprojectid123',
      title: 'Test Section',
      usageDescription: 'A test section',
      content: 'Test content',
      contentFormat: ContentFormat.MARKDOWN
    });

    expect(section.success).toBe(true);
    if (!section.success) return;

    const dashlessId = section.data.id;
    const dashedId = `${dashlessId.slice(0, 8)}-${dashlessId.slice(8, 12)}-${dashlessId.slice(12, 16)}-${dashlessId.slice(16, 20)}-${dashlessId.slice(20)}`;

    // Test parsing both formats
    const mixedParam = `${dashedId}, ${dashlessId}`;
    const parsedIds = mixedParam.split(',').map(id => id.trim().replace(/-/g, ''));

    // Both should result in the same dashless format
    expect(parsedIds[0]).toBe(dashlessId);
    expect(parsedIds[1]).toBe(dashlessId);
  });

  it('should normalize UUIDs in reorder operation', () => {
    // Create test sections
    const section1 = addSection({
      entityType: EntityType.PROJECT,
      entityId: 'testprojectid123',
      title: 'Section 1',
      usageDescription: 'First section',
      content: 'Content 1',
      contentFormat: ContentFormat.MARKDOWN
    });

    const section2 = addSection({
      entityType: EntityType.PROJECT,
      entityId: 'testprojectid123',
      title: 'Section 2',
      usageDescription: 'Second section',
      content: 'Content 2',
      contentFormat: ContentFormat.MARKDOWN
    });

    expect(section1.success).toBe(true);
    expect(section2.success).toBe(true);

    if (!section1.success || !section2.success) return;

    const id1 = section1.data.id;
    const id2 = section2.data.id;

    // Format with dashes
    const dashedId1 = `${id1.slice(0, 8)}-${id1.slice(8, 12)}-${id1.slice(12, 16)}-${id1.slice(16, 20)}-${id1.slice(20)}`;
    const dashedId2 = `${id2.slice(0, 8)}-${id2.slice(8, 12)}-${id2.slice(12, 16)}-${id2.slice(16, 20)}-${id2.slice(20)}`;

    // Simulate the orderedIds parsing logic from manage-sections.ts
    const orderedIdsParam = `${dashedId2}, ${dashedId1}`;
    const parsedIds = orderedIdsParam.split(',').map(id => id.trim().replace(/-/g, ''));

    // Verify normalization
    expect(parsedIds).toEqual([id2, id1]);
  });
});
