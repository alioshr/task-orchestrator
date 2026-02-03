#!/usr/bin/env bun

/**
 * Quick test script for templates repository
 * Run with: bun test_templates.ts
 */

import {
  createTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
  deleteTemplate,
  enableTemplate,
  disableTemplate,
  addTemplateSection,
  applyTemplate
} from './src/repos/templates';
import { EntityType } from './src/domain/types';

console.log('Testing Templates Repository\n');

// Test 1: Create template
console.log('1. Creating template...');
const createResult = createTemplate({
  name: 'Test Project Template',
  description: 'A template for testing projects',
  targetEntityType: EntityType.PROJECT,
  isBuiltIn: false,
  isProtected: false,
  createdBy: 'test-user',
  tags: 'test,project'
});

if (!createResult.success) {
  console.error('❌ Failed to create template:', createResult.error);
  process.exit(1);
}

const templateId = createResult.data.id;
console.log('✅ Template created:', templateId);
console.log('   Name:', createResult.data.name);
console.log('   Target:', createResult.data.targetEntityType);

// Test 2: Get template
console.log('\n2. Getting template...');
const getResult = getTemplate(templateId, false);
if (!getResult.success) {
  console.error('❌ Failed to get template:', getResult.error);
  process.exit(1);
}
console.log('✅ Template retrieved:', getResult.data.template.name);

// Test 3: List templates
console.log('\n3. Listing templates...');
const listResult = listTemplates({ targetEntityType: EntityType.PROJECT });
if (!listResult.success) {
  console.error('❌ Failed to list templates:', listResult.error);
  process.exit(1);
}
console.log('✅ Found', listResult.data.length, 'template(s)');

// Test 4: Add template section
console.log('\n4. Adding template section...');
const sectionResult = addTemplateSection({
  templateId,
  title: 'Overview',
  usageDescription: 'Project overview and goals',
  contentSample: '# Project Overview\n\nDescribe your project here.',
  contentFormat: 'MARKDOWN',
  isRequired: true,
  tags: 'overview'
});

if (!sectionResult.success) {
  console.error('❌ Failed to add section:', sectionResult.error);
  process.exit(1);
}
console.log('✅ Section added:', sectionResult.data.title);
console.log('   Ordinal:', sectionResult.data.ordinal);

// Test 5: Add second section
console.log('\n5. Adding second section...');
const section2Result = addTemplateSection({
  templateId,
  title: 'Technical Details',
  usageDescription: 'Technical implementation details',
  contentSample: '# Technical Details\n\nTechnology stack and architecture.',
  contentFormat: 'MARKDOWN',
  isRequired: false,
  tags: 'technical'
});

if (!section2Result.success) {
  console.error('❌ Failed to add second section:', section2Result.error);
  process.exit(1);
}
console.log('✅ Second section added:', section2Result.data.title);
console.log('   Ordinal:', section2Result.data.ordinal);

// Test 6: Get template with sections
console.log('\n6. Getting template with sections...');
const getWithSectionsResult = getTemplate(templateId, true);
if (!getWithSectionsResult.success) {
  console.error('❌ Failed to get template with sections:', getWithSectionsResult.error);
  process.exit(1);
}
console.log('✅ Template retrieved with', getWithSectionsResult.data.sections?.length, 'sections');
getWithSectionsResult.data.sections?.forEach(s => {
  console.log('   -', s.title, `(ordinal: ${s.ordinal}, required: ${s.isRequired})`);
});

// Test 7: Update template
console.log('\n7. Updating template...');
const updateResult = updateTemplate(templateId, {
  description: 'An updated template for testing projects',
  tags: 'test,project,updated'
});

if (!updateResult.success) {
  console.error('❌ Failed to update template:', updateResult.error);
  process.exit(1);
}
console.log('✅ Template updated');
console.log('   New description:', updateResult.data.description);

// Test 8: Disable template
console.log('\n8. Disabling template...');
const disableResult = disableTemplate(templateId);
if (!disableResult.success) {
  console.error('❌ Failed to disable template:', disableResult.error);
  process.exit(1);
}
console.log('✅ Template disabled:', !disableResult.data.isEnabled);

// Test 9: Enable template
console.log('\n9. Enabling template...');
const enableResult = enableTemplate(templateId);
if (!enableResult.success) {
  console.error('❌ Failed to enable template:', enableResult.error);
  process.exit(1);
}
console.log('✅ Template enabled:', enableResult.data.isEnabled);

// Test 10: Test protected template (create protected one)
console.log('\n10. Testing protected template...');
const protectedResult = createTemplate({
  name: 'Protected Template',
  description: 'Cannot be modified or deleted',
  targetEntityType: EntityType.FEATURE,
  isProtected: true
});

if (!protectedResult.success) {
  console.error('❌ Failed to create protected template:', protectedResult.error);
  process.exit(1);
}
const protectedId = protectedResult.data.id;
console.log('✅ Protected template created');

// Try to update protected template (should fail)
const updateProtectedResult = updateTemplate(protectedId, { description: 'Try to update' });
if (updateProtectedResult.success) {
  console.error('❌ Should not be able to update protected template');
  process.exit(1);
}
console.log('✅ Correctly blocked update of protected template');

// Try to delete protected template (should fail)
const deleteProtectedResult = deleteTemplate(protectedId);
if (deleteProtectedResult.success) {
  console.error('❌ Should not be able to delete protected template');
  process.exit(1);
}
console.log('✅ Correctly blocked deletion of protected template');

// Test 11: Delete template
console.log('\n11. Deleting non-protected template...');
const deleteResult = deleteTemplate(templateId);
if (!deleteResult.success) {
  console.error('❌ Failed to delete template:', deleteResult.error);
  process.exit(1);
}
console.log('✅ Template deleted');

// Verify deletion
const verifyDelete = getTemplate(templateId);
if (verifyDelete.success) {
  console.error('❌ Template should not exist after deletion');
  process.exit(1);
}
console.log('✅ Verified template no longer exists');

console.log('\n✅ All tests passed!');
