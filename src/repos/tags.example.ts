/**
 * Example usage of the tags repository
 *
 * Run with: bun run src/repos/tags.example.ts
 */

import { runMigrations } from '../db/migrate';
import { db, generateId, now } from '../db/client';
import { listTags, getTagUsage, renameTag } from './tags';

// Initialize the database
runMigrations();

// Clean up any existing test data
db.run('DELETE FROM entity_tags');

console.log('=== Tags Repository Examples ===\n');

// Example 1: Add some tags
console.log('1. Adding tags to entities...');
const projectId = generateId();
const featureId = generateId();
const taskId = generateId();

db.run(
  'INSERT INTO entity_tags (id, entity_id, entity_type, tag, created_at) VALUES (?, ?, ?, ?, ?)',
  [generateId(), projectId, 'PROJECT', 'backend', now()]
);
db.run(
  'INSERT INTO entity_tags (id, entity_id, entity_type, tag, created_at) VALUES (?, ?, ?, ?, ?)',
  [generateId(), projectId, 'PROJECT', 'api', now()]
);
db.run(
  'INSERT INTO entity_tags (id, entity_id, entity_type, tag, created_at) VALUES (?, ?, ?, ?, ?)',
  [generateId(), featureId, 'FEATURE', 'authentication', now()]
);
db.run(
  'INSERT INTO entity_tags (id, entity_id, entity_type, tag, created_at) VALUES (?, ?, ?, ?, ?)',
  [generateId(), featureId, 'FEATURE', 'api', now()]
);
db.run(
  'INSERT INTO entity_tags (id, entity_id, entity_type, tag, created_at) VALUES (?, ?, ?, ?, ?)',
  [generateId(), taskId, 'TASK', 'bugfix', now()]
);
console.log('Added 5 tags across 3 entities\n');

// Example 2: List all tags
console.log('2. Listing all tags with counts...');
const allTags = listTags();
if (allTags.success) {
  console.table(allTags.data);
} else {
  console.error('Error:', allTags.error);
}

// Example 3: List tags filtered by entity type
console.log('\n3. Listing tags for PROJECT entities only...');
const projectTags = listTags({ entityType: 'PROJECT' });
if (projectTags.success) {
  console.table(projectTags.data);
} else {
  console.error('Error:', projectTags.error);
}

// Example 4: Get usage of a specific tag
console.log('\n4. Getting usage of "api" tag...');
const apiUsage = getTagUsage('api');
if (apiUsage.success) {
  console.table(apiUsage.data);
} else {
  console.error('Error:', apiUsage.error);
}

// Example 5: Rename a tag (dry run)
console.log('\n5. Dry run: Renaming "api" to "rest-api"...');
const dryRunResult = renameTag('api', 'rest-api', { dryRun: true });
if (dryRunResult.success) {
  console.log(`Would affect ${dryRunResult.data.affected} entities:`);
  console.table(dryRunResult.data.entities);
} else {
  console.error('Error:', dryRunResult.error);
}

// Example 6: Rename a tag (actual)
console.log('\n6. Actually renaming "api" to "rest-api"...');
const renameResult = renameTag('api', 'rest-api');
if (renameResult.success) {
  console.log(`Renamed tag on ${renameResult.data.affected} entities`);
} else {
  console.error('Error:', renameResult.error);
}

// Example 7: Verify the rename
console.log('\n7. Verifying the rename...');
const afterRename = listTags();
if (afterRename.success) {
  console.table(afterRename.data);
} else {
  console.error('Error:', afterRename.error);
}

// Example 8: Handle conflict scenario
console.log('\n8. Testing conflict handling...');
db.run(
  'INSERT INTO entity_tags (id, entity_id, entity_type, tag, created_at) VALUES (?, ?, ?, ?, ?)',
  [generateId(), projectId, 'PROJECT', 'server', now()]
);
console.log('Added "server" tag to project that has "backend"');

const conflictRename = renameTag('backend', 'server');
if (conflictRename.success) {
  console.log(`Handled conflict, affected ${conflictRename.data.affected} entities`);
  console.log('(Deleted old tag instead of creating duplicate)');
} else {
  console.error('Error:', conflictRename.error);
}

// Verify no duplicates
const finalTags = db
  .query('SELECT * FROM entity_tags WHERE entity_id = ? AND entity_type = ?')
  .all(projectId, 'PROJECT') as any[];
console.log(`\nProject now has ${finalTags.length} tags (no duplicates):`);
console.table(finalTags.map(t => ({ tag: t.tag })));

console.log('\n=== Examples Complete ===');
