# Bug #6 Fix Verification

## Bug Description

**Bug #6:** `manage_sections` `reorder` operation failed when `orderedIds` contained dashed UUIDs (e.g. `5ceffde0-4ece-4b16-b12a-9cd1d8353322`). It only worked with dashless UUIDs (e.g. `5ceffde04ece4b16b12a9cd1d8353322`).

**Error Message:** "Section not found or does not belong to entity"

## Root Cause

The `orderedIds` parameter is a comma-separated string of section UUIDs. When parsed by splitting on commas, the individual IDs weren't having dashes stripped before being used in DB lookups. The UUID normalization fix (commit 9cd951d) added `uuidSchema` for individual UUID parameters but didn't handle comma-separated UUID strings.

## Fixes Applied

### 1. Fixed `manage-sections.ts` Reorder Operation (Line 225)

**Before:**
```typescript
const orderedIds = params.orderedIds.split(',').map(id => id.trim());
```

**After:**
```typescript
const orderedIds = params.orderedIds.split(',').map(id => id.trim().replace(/-/g, ''));
```

### 2. Fixed `query-sections.ts` Section IDs Filter (Line 26)

**Before:**
```typescript
const sectionIds = params.sectionIds
  ? params.sectionIds.split(',').map(id => id.trim())
  : undefined;
```

**After:**
```typescript
const sectionIds = params.sectionIds
  ? params.sectionIds.split(',').map(id => id.trim().replace(/-/g, ''))
  : undefined;
```

### 3. Fixed `reorderSections()` in `repos/sections.ts`

**Issue:** The function was attempting to update ordinals sequentially, which violated the UNIQUE constraint on `(entity_type, entity_id, ordinal)`.

**Solution:** Implemented a two-phase approach:
1. **Phase 1:** Set all sections to temporary negative ordinals to avoid conflicts
2. **Phase 2:** Update to final ordinal values

**After:**
```typescript
export function reorderSections(
  entityId: string,
  entityType: string,
  orderedIds: string[]
): Result<boolean> {
  try {
    db.run('BEGIN TRANSACTION');

    try {
      const timestamp = now();

      // Phase 1: Set all sections to temporary negative ordinals
      for (let i = 0; i < orderedIds.length; i++) {
        const changes = execute(
          'UPDATE sections SET ordinal = ?, modified_at = ? WHERE id = ? AND entity_id = ? AND entity_type = ?',
          [-(i + 1), timestamp, orderedIds[i], entityId, entityType]
        );

        if (changes === 0) {
          throw new Error(`Section not found or does not belong to entity: ${orderedIds[i]}`);
        }
      }

      // Phase 2: Set final ordinal values
      for (let i = 0; i < orderedIds.length; i++) {
        execute(
          'UPDATE sections SET ordinal = ? WHERE id = ? AND entity_id = ? AND entity_type = ?',
          [i, orderedIds[i], entityId, entityType]
        );
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
```

## Note on `bulkDelete`

The `bulkDelete` operation in `manage-sections.ts` (line 338) already had the fix applied:
```typescript
const sectionIds = params.sectionIds.split(',').map(id => id.trim().replace(/-/g, ''));
```

## Tests Added

### 1. Repository-Level Tests (`src/repos/sections.test.ts`)

Added comprehensive `reorderSections` test suite:
- ✅ Should reorder sections and update ordinals correctly
- ✅ Should fail when section does not belong to entity
- ✅ Should fail when section ID does not exist
- ✅ Should handle empty orderedIds array

### 2. Integration Tests (`src/tools/manage-sections.test.ts`)

Added Bug #6 specific integration tests:
- ✅ Should handle comma-separated dashless UUIDs in orderedIds parameter
- ✅ Should handle comma-separated dashed UUIDs in orderedIds parameter (Bug #6 scenario)
- ✅ Should handle mixed whitespace in comma-separated UUIDs
- ✅ Should handle bulkDelete with dashed UUIDs in sectionIds parameter
- ✅ Should handle query_sections with dashed UUIDs in sectionIds filter parameter

## Test Results

All tests pass:
```
bun test src/repos/sections.test.ts src/tools/manage-sections.test.ts

 15 pass
 0 fail
 75 expect() calls
Ran 15 tests across 2 files. [20.00ms]
```

TypeScript type checking passes:
```
bunx tsc --noEmit
(no errors)
```

## Files Modified

1. `/src/tools/manage-sections.ts` - Fixed reorder operation (line 225)
2. `/src/tools/query-sections.ts` - Fixed sectionIds filter (line 26)
3. `/src/repos/sections.ts` - Fixed reorderSections to handle UNIQUE constraint (lines 349-397)
4. `/src/repos/sections.test.ts` - Added reorderSections test suite
5. `/src/tools/manage-sections.test.ts` - New file with Bug #6 integration tests

## Verification

Bug #6 is now fully fixed. The `manage_sections` `reorder` operation now correctly handles:
- Dashed UUIDs (e.g., `5ceffde0-4ece-4b16-b12a-9cd1d8353322`)
- Dashless UUIDs (e.g., `5ceffde04ece4b16b12a9cd1d8353322`)
- Mixed whitespace in comma-separated lists
- UNIQUE constraint on `(entity_type, entity_id, ordinal)` during reorder operations

Similarly, `query_sections` and `bulkDelete` operations now properly handle dashed UUIDs in their respective comma-separated parameters.
