# Knowledge Graph Specification

Architectural knowledge layer for persistent codebase memory across agent sessions. Lives inside the task orchestrator as new tables and MCP tools.

## Problem

Agents start every session from zero. Developers re-explain the same architectural context repeatedly: which services talk to which, where locales come from, what's been migrated and what hasn't. This knowledge doesn't live in the code (agents can read code) — it lives in developers' heads.

## Solution

A two-layer knowledge hierarchy attached to projects. Molecules group atoms. Atoms own path patterns and hold the architectural knowledge agents need. File paths are matched to atoms at query time — no per-file tracking, no per-file token cost.

```
Project
  ├── Features / Tasks       (work breakdown)
  └── Molecules / Atoms      (codebase knowledge)
        ├── Molecule: Pages
        │     ├── Atom: Checkout Page
        │     ├── Atom: Profile Page
        │     └── Atom: Dashboard Page
        └── Molecule: API Layer
              ├── Atom: Auth Endpoints
              └── Atom: Payment Endpoints
```

Features organize work. Molecules and atoms organize knowledge. They relate through the codebase itself (file paths), not through direct references.

## Data Models

### Molecule

Groups related atoms under a common domain. Answers: "What's the big picture for this area of the system?"

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| projectId | uuid | FK to orchestrator project |
| name | string | "Pages", "API Layer", "Shared Infrastructure" |
| knowledge | text | Cross-atom context: service boundaries, domain rules, shared conventions. Editable: append or overwrite |
| relatedMolecules | text | JSON array of `{ moleculeId, reason }` describing relationships to other molecules |
| createdByTaskId | uuid | Task that triggered creation |
| lastTaskId | uuid | Task that last updated this molecule |
| version | int | Optimistic locking, starts at 1 |
| createdAt | timestamp | |
| updatedAt | timestamp | |

### Atom

The core knowledge unit. Owns a set of path patterns and holds architectural knowledge about that area of the codebase. Answers: "I need to work on files in this area, what do I need to know?"

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| projectId | uuid | FK to orchestrator project |
| moleculeId | uuid, nullable | FK to molecule. Nullable — orphan atoms are allowed |
| name | string | "Checkout Page", "Auth Endpoints", "Event Bus" |
| paths | text | JSON array of glob patterns: `["src/pages/checkout/**", "src/components/checkout-*.tsx"]` |
| knowledge | text | How files in this area work together, patterns, constraints, integration points. Editable: append or overwrite |
| relatedAtoms | text | JSON array of `{ atomId, reason }` describing relationships to other atoms |
| createdByTaskId | uuid | Task that triggered creation |
| lastTaskId | uuid | Task that last updated this atom |
| version | int | Optimistic locking, starts at 1 |
| createdAt | timestamp | |
| updatedAt | timestamp | |

### ChangelogEntry

Append-only evolution trail at the atom level. Entries are never edited — history is immutable.

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| parentType | enum | "atom", "molecule" |
| parentId | uuid | FK, polymorphic based on parentType |
| taskId | uuid | FK to orchestrator task |
| summary | text | What changed and why |
| createdAt | timestamp | |

Changelog entries are resolved via reverse lookup (`parentType + parentId`) and included inline when querying atoms or molecules.

## Path Pattern Matching

Atoms own glob patterns, not exact file paths. When the `context` operation receives file paths, it matches each path against all atom path patterns within the project.

Matching rules:
- Standard glob syntax: `*` matches within a directory, `**` matches across directories
- A file can match multiple atoms (a shared utility might match both "Auth" and "Payments" atoms)
- Files that match no atom are reported as `unmatchedPaths` in the response
- Patterns are evaluated in order; all matches are returned (no first-match-wins)

Examples:
- `["src/pages/checkout/**"]` — matches all files under the checkout page directory
- `["src/payments/gateway/**", "src/payments/stripe-*.ts"]` — matches gateway directory plus specific stripe files
- `["src/shared/email-client.ts"]` — matches a single specific file

When files move (refactor), update the atom's `paths` array — one field change instead of N node updates.

## Hierarchy

```
Project (1) ──→ Molecule (many) ──→ Atom (many)
                                        ↓ ChangelogEntries (timeline)
```

Cross-cutting relationships are stored as fields, not separate tables:
- `atom.relatedAtoms` — `[{ atomId: "...", reason: "consumes events from" }]`
- `molecule.relatedMolecules` — `[{ moleculeId: "...", reason: "pages consume API layer endpoints" }]`

This avoids a separate edges table. Relationships are lightweight, human-readable, and maintained alongside the knowledge they describe.

## Reading Changelog

Two access patterns:

### Shallow (default)

When querying an atom or molecule, the response includes the last N changelog entries (default 5) inline. Covers the common case.

### Deep (on demand)

Paginated query for full history via `manage_changelog search`. Used when the agent needs complete evolution context.

## Traceability

| Depth | Field | Question it answers |
|-------|-------|---------------------|
| Quick | lastTaskId | "What task last touched this?" |
| Medium | createdByTaskId | "Why was this created?" |
| Deep | changelog entries | "How did this area evolve over time?" |

No direct FK between atoms and features/tasks. The connection is implicit: a task's Context Files paths match atom path patterns at query time. The `lastTaskId` and changelog `taskId` fields provide the reverse traceability.

## Skill Integration

### Discovery (reads the graph)

After surfacing active work and suggesting the next task:

1. Fetch the suggested task's sections, read Context Files
2. Query atoms matching those file paths via `query_graph context`
3. Surface molecule and atom knowledge alongside the task suggestion

### Planning (reads + creates structures)

While creating features, tasks, and filling sections:

1. Search for atoms matching the work area via `query_graph search`
2. Use atom/molecule knowledge to write better Implementation Plans and Context Files
3. Create new molecules and atoms for areas that don't have coverage yet
4. Flag `unmatchedPaths` — files in the plan that no atom covers

### Execution (updates knowledge)

After verification passes, before status advancement:

1. Identify which files were touched
2. Check which atoms match those files
3. Update atom knowledge if the work changed how the area works
4. Update atom paths if files were moved or new directories were created
5. Create new atoms if the work created a new area with no coverage
6. Append changelog entries for significant changes

## MCP Tool Design

### New Tools (3 tools)

#### `query_graph` — All reads

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| operation | enum: `get`, `search`, `context` | yes | |
| entityType | enum: `atom`, `molecule` | for get/search | |
| id | uuid | for `get` | Entity ID |
| projectId | uuid | for `search`/`context` | Scope to project |
| paths | string | for `context` | Comma-separated file paths to match against atom patterns |
| query | string | for `search` | Text search on knowledge/name |
| moleculeId | uuid | for `search` | Filter atoms by molecule |
| orphansOnly | boolean | for `search` | Atoms without molecule |
| includeChangelog | boolean | optional, default true | Include last N changelog entries |
| changelogLimit | int | optional, default 5 | How many changelog entries |
| limit | int | optional, default 20 | Pagination for search |
| offset | int | optional, default 0 | Pagination for search |

**Operations:**

`get` — Fetch a single atom or molecule by ID with changelog. For molecules, also returns member atoms.

`search` — Filtered list. Find atoms by moleculeId, by text query, or orphans only. Find molecules by text query.

`context` — The key operation. Takes file paths, glob-matches against atom path patterns, walks up to molecules. Returns:

```json
{
  "success": true,
  "data": {
    "molecules": [
      {
        "id": "...", "name": "Payment Domain",
        "knowledge": "Communicates with Stripe, idempotent webhooks, event sourcing",
        "atoms": [
          {
            "id": "...", "name": "Webhook Handlers",
            "knowledge": "8 handlers, all extend BaseWebhookHandler, locales from registry",
            "matchedPaths": ["src/payments/webhook-handler.ts", "src/payments/stripe-gateway.ts"],
            "relatedAtoms": [
              { "atomId": "...", "name": "Stripe Integration", "reason": "webhooks call gateway for processing" }
            ],
            "changelog": [
              { "taskId": "...", "summary": "...", "createdAt": "..." }
            ]
          }
        ]
      }
    ],
    "orphanAtoms": [
      {
        "id": "...", "name": "Retry Utilities",
        "knowledge": "Generic exponential backoff",
        "matchedPaths": ["src/shared/retry-utils.ts"]
      }
    ],
    "unmatchedPaths": ["src/payments/new-handler.ts"]
  }
}
```

- `matchedPaths`: which of the requested paths matched this atom's patterns
- `orphanAtoms`: atoms with no molecule that matched
- `unmatchedPaths`: requested paths that no atom covers — signals knowledge gaps

Response ordering is deterministic: molecules by name, atoms by name within molecule.

---

#### `manage_graph` — All writes

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| operation | enum: `create`, `update`, `delete` | yes | |
| entityType | enum: `atom`, `molecule` | yes | |
| id | uuid | for update/delete | Entity ID |
| version | int | for update/delete | Optimistic locking |
| projectId | uuid | for create | FK to orchestrator project |
| name | string | for create | Display name |
| paths | string | for create/update atom | JSON array of glob patterns |
| knowledge | string | for create/update | The knowledge content |
| knowledgeMode | enum: `overwrite`, `append` | for update, default `overwrite` | |
| moleculeId | uuid, nullable | for create/update atom | Assign or reassign molecule |
| relatedAtoms | string | for create/update atom | JSON array of `{ atomId, reason }` |
| relatedMolecules | string | for create/update molecule | JSON array of `{ moleculeId, reason }` |
| createdByTaskId | uuid | for create | Task that triggered creation |
| lastTaskId | uuid | for update | Task performing the update |
| cascade | boolean | for delete, default false | |

**`knowledgeMode` behavior:**

- `overwrite` — Replaces the entire knowledge field.
- `append` — Prepends a separator line with timestamp and taskId before the appended content: `\n\n---[{timestamp} task:{taskId}]---\n{appended text}`. Self-documenting without requiring a changelog entry.

**Business logic — Create:**

- `molecule`: Validates projectId exists. Sets version to 1.
- `atom`: Validates projectId exists. Validates path patterns are valid globs. If moleculeId provided, validates molecule exists and belongs to same project. Sets version to 1.

**Business logic — Update:**

- Version check required (reject on mismatch with `CONFLICT` error).
- `molecule`: Can update knowledge, name, relatedMolecules. Cannot change projectId.
- `atom`: Can update knowledge, name, paths, moleculeId, relatedAtoms. Cannot change projectId.

**Business logic — Delete:**

- `molecule`: When `cascade=false` (default): orphans member atoms (sets moleculeId to null, updates their `updated_at` and `last_task_id`), deletes molecule's changelog entries. When `cascade=true`: deletes member atoms and their changelog entries.
- `atom`: Deletes atom and its changelog entries.

---

#### `manage_changelog` — Append and search history

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| operation | enum: `append`, `search` | yes | |
| parentType | enum: `atom`, `molecule` | yes | |
| parentId | uuid | yes | Entity the changelog belongs to |
| taskId | uuid | for append | FK to orchestrator task |
| summary | string | for append | What changed and why |
| limit | int | for search, default 20 | Pagination |
| offset | int | for search, default 0 | Pagination |

**Append:** Validates parent exists. Validates taskId exists. Creates immutable entry.

**Search:** Returns paginated entries ordered by createdAt DESC.

---

### Existing Tools Modified (2 tools)

#### `query_container` — Add `includeGraphContext`

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| includeGraphContext | boolean | false | Resolve knowledge graph context for the task |

Only applies to `get` operation on tasks. When enabled:

1. Reads the task's Context Files section
2. Extracts file paths (line-delimited, comma-separated, or mixed — degrades gracefully)
3. Internally runs `query_graph context` logic with those paths
4. Includes the result as `graphContext` in the response

```json
{
  "success": true,
  "data": {
    "task": { "..." },
    "sections": [ "..." ],
    "graphContext": {
      "molecules": [ "..." ],
      "orphanAtoms": [ "..." ],
      "unmatchedPaths": [ "..." ]
    }
  }
}
```

#### `advance` — Surface graph update hints

No new parameters. When a task reaches a terminal status, the response includes:

```json
{
  "graphHints": {
    "message": "Task completed. Consider updating the knowledge graph.",
    "suggestedActions": [
      "Update atom knowledge for areas affected by this task",
      "Update atom paths if files were moved or new directories created",
      "Append changelog entries for significant changes"
    ]
  }
}
```

Passive hint, not enforcement. The execution skill handles the actual graph update.

---

### Tools NOT Modified

- `manage_container`, `query_sections`, `manage_sections` — No graph interaction.
- `get_next_task`, `get_next_feature` — Stay fast, no graph queries. Discovery skill queries graph separately.
- `manage_dependency`, `block`, `unblock`, `revert`, `terminate` — No graph interaction.
- Template and tag tools — No graph interaction.

## Migration

New migration file: `src/db/migrations/002_knowledge_graph.sql`

```sql
-- 1. Molecules (no FK dependencies on other graph tables)
CREATE TABLE graph_molecules (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  knowledge TEXT NOT NULL DEFAULT '',
  related_molecules TEXT NOT NULL DEFAULT '[]',
  created_by_task_id TEXT NOT NULL,
  last_task_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 2. Atoms reference molecules
CREATE TABLE graph_atoms (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  molecule_id TEXT REFERENCES graph_molecules(id),
  name TEXT NOT NULL,
  paths TEXT NOT NULL DEFAULT '[]',
  knowledge TEXT NOT NULL DEFAULT '',
  related_atoms TEXT NOT NULL DEFAULT '[]',
  created_by_task_id TEXT NOT NULL,
  last_task_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 3. Changelog (polymorphic)
CREATE TABLE graph_changelog (
  id TEXT PRIMARY KEY,
  parent_type TEXT NOT NULL CHECK(parent_type IN ('atom', 'molecule')),
  parent_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 4. Indexes
CREATE INDEX idx_graph_molecules_project ON graph_molecules(project_id);
CREATE INDEX idx_graph_atoms_project ON graph_atoms(project_id);
CREATE INDEX idx_graph_atoms_molecule ON graph_atoms(molecule_id);
CREATE INDEX idx_graph_changelog_parent ON graph_changelog(parent_type, parent_id);
CREATE INDEX idx_graph_changelog_task ON graph_changelog(task_id);
```

Run as a single transaction. Task ID fields are plain text without FK constraints to `tasks(id)` — validated on write at application level, degrade gracefully for deleted tasks.

## Validation Rules

### Path pattern validation (atoms)

- Each pattern in the `paths` array must be a valid glob.
- Must be relative (no leading `/`).
- Must not contain traversal segments (`..`).
- Array must not be empty on create (an atom without paths has no boundary).
- Max 20 patterns per atom. Max 512 characters per pattern.

### Text field bounds

- `knowledge`: max 32 KB. Trim whitespace.
- `summary` (changelog): non-empty, max 4 KB.
- `name`: non-empty, max 255 characters.
- `relatedAtoms`, `relatedMolecules`: valid JSON arrays, max 50 entries.

### Concurrency

- `version` required on all update AND delete operations.
- On mismatch, return `CONFLICT` with current version in payload.

### Error codes

- `VALIDATION_ERROR` — Bad input.
- `NOT_FOUND` — Referenced entity does not exist.
- `CONFLICT` — Version mismatch.
- `INVARIANT_VIOLATION` — Cross-project membership, empty paths array.

## Knowledge Field Guidelines

The knowledge field is editable — append or overwrite. Intentionally loose.

### Atom knowledge

- How files in this area work together as a unit
- Shared patterns, conventions, constraints
- Integration points with other atoms
- Non-obvious gotchas ("locales come from registry, not local i18n files")
- "All webhook handlers extend BaseWebhookHandler, must be idempotent, 30s timeout from Stripe"

### Molecule knowledge

- Cross-atom context that applies to the whole group
- Shared conventions across all atoms in the molecule
- "All pages use the shared layout system, route guards handled in middleware, page-level state in Zustand stores"

## Behavioral Clarifications

- **Graph write timing**: Allowed at any point — not tied to task pipeline status.
- **Path extraction from Context Files**: Degrades gracefully. Malformed lines skipped. Unmatched paths reported in `unmatchedPaths`.
- **Auto-changelog**: No. Changelog entries are always explicit. The `knowledgeMode=append` separator provides lightweight traceability for incremental updates.
- **Overlapping path patterns**: A file can match multiple atoms. The `context` response returns all matching atoms, not just the first. This is correct — a shared utility used by auth and payments should surface both atoms' knowledge.
- **Orphan atoms**: Atoms without a molecule are valid. They appear in `orphanAtoms` in context responses. Useful for standalone utilities or areas not yet organized into molecules.
