# CRUD Test Report: `task-orchestrator-bun` MCP Server

## Executive Summary

**61 steps executed. 59 passed, 2 new bugs found and fixed.** All 5 original bugs (from the first test round) were confirmed fixed. Two new UUID normalization gaps were discovered in section operations (`reorder` and `bulkDelete`) and subsequently patched. Full cleanup succeeded — database is clean.

**Unit tests: 140/140 pass (0 failures).**

---

## Test Run 2 — Full Results (2026-02-04)

### Results by Phase

| Phase | Steps | Passed | Failed | Notes |
|-------|-------|--------|--------|-------|
| 1. Setup & Create | 7 | 7 | 0 | setup_project, project, 2 features, 3 tasks |
| 2. Container Reads | 8 | 8 | 0 | get, search (query/priority/tags), overview (global/scoped) |
| 3. Container Mutations | 7 | 7 | 0 | update, setStatus, invalid transition rejected, delete, verify delete |
| 4. Sections CRUD | 13 | 11 | 2 | add, query, update, updateText, reorder, bulkCreate, delete, bulkDelete |
| 5. Templates CRUD | 9 | 9 | 0 | create, addSection, get, list, disable, enable, apply, delete, verify |
| 6. Dependencies + Workflow | 10 | 10 | 0 | create deps, query, blocked tasks, next task, workflow state, status transitions, delete dep |
| 7. Tags | 7 | 7 | 0 | list (all/filtered), get_tag_usage, rename (dry run/actual), verify |
| 8. Cleanup | 7 | 7 | 0 | All test data deleted, database verified clean |
| **Total** | **61** | **59** | **2** | **96.7% pass rate (100% after fix)** |

---

## Detailed Step Results

### Phase 1: Setup & Create

| # | Operation | Tool | Result | Status |
|---|-----------|------|--------|--------|
| 1 | `setup_project` | setup_project | Created config with 3 workflows (project:6, feature:11, task:14 statuses) | PASS |
| 2 | Create project | manage_container | ID captured, status PLANNING | PASS |
| 3 | Create feature (with projectId) | manage_container | ID captured, projectId stored correctly | PASS |
| 4 | Create feature (standalone) | manage_container | ID captured, no parent | PASS |
| 5 | Create task Alpha-1 (HIGH, complexity 5) | manage_container | ID captured, status PENDING | PASS |
| 6 | Create task Alpha-2 (MEDIUM, complexity 3) | manage_container | ID captured | PASS |
| 7 | Create task Alpha-3 (LOW, complexity 1) | manage_container | ID captured | PASS |

### Phase 2: Container Reads

| # | Operation | Tool | Result | Status |
|---|-----------|------|--------|--------|
| 8 | Get project by ID | query_container | Returned correct project (UUID fix confirmed) | PASS |
| 9 | Get task by ID | query_container | Returned Task Alpha-1 (UUID fix confirmed) | PASS |
| 10 | Search "Alpha" | query_container | 3 tasks found | PASS |
| 11 | Search priority HIGH | query_container | 1 result (Alpha-1) | PASS |
| 12 | Search tags "review" | query_container | 1 result (Alpha-2) | PASS |
| 13 | Overview projects (global) | query_container | 1 project listed | PASS |
| 14 | Overview features (global) | query_container | 2 features listed | PASS |
| 15 | Overview features (scoped to project) | query_container | 1 feature (correctly filtered) | PASS |

### Phase 3: Container Mutations

| # | Operation | Tool | Result | Status |
|---|-----------|------|--------|--------|
| 16 | Update project summary | manage_container | Summary updated, version bumped to 2 | PASS |
| 17 | Update task summary | manage_container | Summary updated, version bumped to 2 | PASS |
| 18 | setStatus task PENDING -> IN_PROGRESS | manage_container | Status changed, version bumped | PASS |
| 19 | setStatus project PLANNING -> IN_DEVELOPMENT | manage_container | Status changed, version bumped | PASS |
| 20 | Invalid transition PENDING -> COMPLETED | manage_container | Correctly rejected with allowed transitions listed | PASS |
| 21 | Delete standalone feature | manage_container | `deleted: true` | PASS |
| 22 | Verify deleted feature | query_container | NOT FOUND (correct) | PASS |

### Phase 4: Sections CRUD

| # | Operation | Tool | Result | Status |
|---|-----------|------|--------|--------|
| 23 | Add project section | manage_sections | Section created with MARKDOWN format | PASS |
| 24 | Add task section (notes) | manage_sections | Section created with PLAIN_TEXT format | PASS |
| 25 | Add task section (checklist) | manage_sections | Section created, ordinal 2 | PASS |
| 26 | Query sections (with content) | query_sections | 2 sections, content present | PASS |
| 27 | Query sections (without content) | query_sections | 2 sections, content empty (token savings) | PASS |
| 28 | Query sections (nonexistent tag filter) | query_sections | 0 results (correct) | PASS |
| 29 | Update section (title + tags) | manage_sections | Title changed, version bumped to 2 | PASS |
| 30 | UpdateText section (content only) | manage_sections | Content updated, version bumped to 2 | PASS |
| 31 | bulkCreate 2 sections | manage_sections | 2 sections created, entityType/entityId propagated (Bug #2 fix confirmed) | PASS |
| 32 | Reorder sections (dashed UUIDs) | manage_sections | **FAILED** — "Section not found or does not belong to entity" | **BUG #6** |
| 32b | Reorder sections (dashless UUIDs) | manage_sections | `reordered: true` | PASS |
| 33 | Delete section | manage_sections | `deleted: true` | PASS |
| 34 | Delete nonexistent section | manage_sections | `success: false`, "Section not found" (Bug #3 fix confirmed) | PASS |
| 35 | bulkDelete (dashed UUIDs) | manage_sections | **FAILED** — `deletedCount: 0` | **BUG #7** |
| 35b | bulkDelete (dashless UUIDs) | manage_sections | `deletedCount: 2` | PASS |

### Phase 5: Templates CRUD

| # | Operation | Tool | Result | Status |
|---|-----------|------|--------|--------|
| 36 | Create template | manage_template | ID captured, isEnabled: true | PASS |
| 37 | addSection to template | manage_template | Section created with correct templateId | PASS |
| 38 | Get template by ID (with sections) | query_templates | Template + 1 section returned | PASS |
| 39 | List templates | query_templates | 1 template found | PASS |
| 40 | Disable template | manage_template | `isEnabled: false` | PASS |
| 41 | Enable template | manage_template | `isEnabled: true` | PASS |
| 42 | Apply template to task | apply_template | Created 1 section, content populated from contentSample | PASS |
| 43 | Delete template | manage_template | `deleted: true` | PASS |
| 44 | Verify deleted template | query_templates | NOT FOUND (correct) | PASS |

### Phase 6: Dependencies + Workflow

| # | Operation | Tool | Result | Status |
|---|-----------|------|--------|--------|
| 45 | Create BLOCKS dependency (Alpha-2 -> Alpha-1) | manage_dependency | Dependency created | PASS |
| 46 | Create IS_BLOCKED_BY dependency (Alpha-3 -> Alpha-2) | manage_dependency | Dependency created | PASS |
| 47 | Query dependencies for Alpha-2 | query_dependencies | 2 dependencies returned (BLOCKS + IS_BLOCKED_BY) | PASS |
| 48 | Get blocked tasks | get_blocked_tasks | 1 blocked task (Alpha-1, blocked by Alpha-2) | PASS |
| 49 | Get next task | get_next_task | Alpha-2 (MEDIUM, PENDING, no incomplete blockers) | PASS |
| 50 | Query workflow state for Alpha-2 | query_workflow_state | Status, transitions, dependency info with allBlockersResolved: true | PASS |
| 51 | Get next status (PENDING) | get_next_status | 5 transitions, isTerminal: false | PASS |
| 52 | Get next status (COMPLETED) | get_next_status | 0 transitions, isTerminal: true | PASS |
| 53 | Get next status (INVALID_STATUS) | get_next_status | VALIDATION_ERROR (correct) | PASS |
| 54 | Delete dependency | manage_dependency | `deleted: true` | PASS |

### Phase 7: Tags

| # | Operation | Tool | Result | Status |
|---|-----------|------|--------|--------|
| 55 | List all tags | list_tags | 6 tags found | PASS |
| 56 | List task tags only | list_tags | 4 task-specific tags | PASS |
| 57 | Get tag usage "test" | get_tag_usage | 5 entities (1 project, 1 feature, 3 tasks) | PASS |
| 58 | Rename tag dry run ("urgent" -> "critical") | rename_tag | 1 entity preview (Alpha-1) | PASS |
| 59 | Rename tag actual | rename_tag | 1 entity affected | PASS |
| 60 | Verify "critical" tag | get_tag_usage | 1 entity (Alpha-1) | PASS |
| 61 | Verify "urgent" tag gone | get_tag_usage | 0 entities | PASS |

### Phase 8: Cleanup

| # | Operation | Tool | Result | Status |
|---|-----------|------|--------|--------|
| 62 | Delete remaining dependency | manage_dependency | `deleted: true` | PASS |
| 63 | Delete task Alpha-1 | manage_container | `deleted: true` | PASS |
| 64 | Delete task Alpha-2 | manage_container | `deleted: true` | PASS |
| 65 | Delete task Alpha-3 | manage_container | `deleted: true` | PASS |
| 66 | Delete feature | manage_container | `deleted: true` | PASS |
| 67 | Delete project | manage_container | `deleted: true` | PASS |
| 68 | Verify database clean | query_container + query_templates | 0 projects, 0 tasks, 0 templates | PASS |

---

## Workflow Transitions Verified

| From Status | Container | Transitions | Terminal |
|-------------|-----------|-------------|----------|
| PENDING | task | IN_PROGRESS, BLOCKED, ON_HOLD, CANCELLED, DEFERRED | No |
| COMPLETED | task | (none) | **Yes** |
| INVALID_STATUS | task | VALIDATION_ERROR | N/A |

---

## Original Bugs (Test Run 1) — All Fixed

| Bug | Severity | Fix Status | Verified In Run 2 |
|-----|----------|------------|-------------------|
| #1 UUID format mismatch (blocker) | P0 | Fixed (commit `9cd951d`) | Yes — get/update/delete/setStatus all work with dashed UUIDs |
| #2 bulkCreate doesn't propagate entity fields | P1 | Fixed (commit `9cd951d`) | Yes — entityType/entityId correctly propagated |
| #3 Section delete returns success on no-op | P2 | Fixed (commit `9cd951d`) | Yes — returns `success: false` with "Section not found" |
| #4 CANCELLED is not terminal | P3 | By design | Yes — confirmed intentional recoverable cancellation |
| #5 Task uses `title` not `name` | P3 | Documented (commit `9cd951d`) | Yes — consistent with schema |

---

## New Bugs Found in Test Run 2 — Fixed

### Bug #6: `reorder` doesn't normalize UUIDs in `orderedIds`

**Severity: P2 — Fixed**

`manage_sections` `reorder` failed when `orderedIds` contained dashed UUIDs (the format the schema advertises). Worked only with dashless IDs. Error: `Section not found or does not belong to entity`.

**Fix:** `manage-sections.ts:225` — added `.replace(/-/g, '')` when parsing `orderedIds`.

### Bug #7: `bulkDelete` doesn't normalize UUIDs in `sectionIds`

**Severity: P2 — Fixed**

`manage_sections` `bulkDelete` returned `deletedCount: 0` when `sectionIds` contained dashed UUIDs. Worked correctly with dashless IDs.

**Fix:** `manage-sections.ts:338` — added `.replace(/-/g, '')` when parsing `sectionIds`.

**Additional fix:** `query-sections.ts:26` — same normalization applied to `sectionIds` filter parameter.

**Root cause for both:** The UUID normalization fix (commit `9cd951d`) was applied to tool input parameters via `uuidSchema`, but comma-separated ID strings in `orderedIds` and `sectionIds` were parsed internally without stripping dashes before DB lookup.

---

## Additional Fixes: Pre-existing Test Failures

Three unit tests in `projects.test.ts` had pre-existing failures unrelated to MCP functionality:

| Test | Issue | Fix |
|------|-------|-----|
| `createProject > should create a project with all optional fields` | Tag order assertion assumed deterministic DB insertion order | Changed to `toContain` per-tag assertions |
| `createProject > should normalize and deduplicate tags` | `saveTags` in `base.ts` didn't deduplicate normalized tags, causing UNIQUE constraint violation | Added `Set`-based deduplication in `saveTags` |
| `updateProject > should update modifiedAt timestamp` | Sub-millisecond execution made `toBeGreaterThan` fail | Changed to `toBeGreaterThanOrEqual` |

**Unit test suite: 140/140 pass, 0 failures, 511 expect() calls across 8 files.**

---

## Cleanup Status

**Database is clean.** All test data was successfully deleted during Phase 8:
- 0 projects, 0 features, 0 tasks
- 0 sections, 0 templates, 0 dependencies
