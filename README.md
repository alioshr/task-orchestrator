# Task Orchestrator Bun (v3)

Bun/TypeScript MCP server for hierarchical work orchestration with SQLite persistence.

This implementation is intentionally agent-first:
- Intent-based state transitions (`advance`, `revert`, `terminate`) instead of target-state mutation.
- Linear, configurable pipelines for `task` and `feature` states.
- Cross-entity dependency blocking (`task` <-> `feature`) with automatic unblocking rules.
- Lean schema and operational model with optimistic locking.

## What This Server Solves

AI agents struggle when they must manually reason about workflow internals before each state mutation.

This server reduces that burden by exposing high-level transition intent:
- The agent says "advance this item".
- The server validates version, transition legality, blocking constraints, and side effects.
- The server returns canonical transition output, affected entities, and warnings.

## Core Model

### Hierarchy

- `project` is a stateless board container.
- `feature` contains grouped work.
- `task` is executable work, optionally under a feature.
- `molecule` groups related knowledge areas within a project (e.g., domains, systems).
- `atom` maps file patterns to knowledge about how those files work, optionally under a molecule.

### Status Philosophy

- `project` has no workflow status.
- `feature` and `task` follow linear pipelines.
- Terminal states are:
  - pipeline last state (default `CLOSED`)
  - `WILL_NOT_IMPLEMENT` (exit state)

### Blocking and Related Links

- Blocking is stored directly on entities via `blocked_by` and `blocked_reason`.
- Related links are symmetric via `related_to`.
- Dependency table is not used in v3.

## Architecture

- Runtime: Bun
- Language: TypeScript (ESM)
- Persistence: SQLite (`bun:sqlite`)
- Transport:
  - STDIO MCP (default)
  - Streamable HTTP MCP (`--http` or `TRANSPORT=http`)

Main entry points:
- CLI/server: `src/server.ts`
- Bootstrap: `src/bootstrap.ts`
- Config: `src/config/index.ts`
- Migration runner: `src/db/migrate.ts`

## Installation

### Prerequisites

- Bun >= 1.0

### Install

```bash
bun install
```

### Run (STDIO)

```bash
bun run src/server.ts
```

### Run (HTTP)

```bash
bun run src/server.ts --http
```

Optional env vars:
- `PORT` for HTTP mode (default `3100`)
- `TRANSPORT=http` as alternative to `--http`
- `TASK_ORCHESTRATOR_HOME` to control config/db location

HTTP mode endpoints:
- MCP: `http://127.0.0.1:<PORT>/mcp`
- Status: `http://127.0.0.1:<PORT>/status`

## Storage and Paths

Default home directory:
- `~/.task-orchestrator`

Files:
- Config: `~/.task-orchestrator/config.yaml`
- Database: `~/.task-orchestrator/tasks.db`
- Runtime status: `~/.task-orchestrator/runtime/mcp-http-status.json`

Override both by setting:
- `TASK_ORCHESTRATOR_HOME=/custom/path`

## Bootstrapping Behavior

On server startup (`bootstrap()`):
1. Ensures `config.yaml` exists (writes default if missing)
2. Runs migrations (idempotent)
3. Loads and validates config
4. Runs startup checks for orphaned statuses

## Configuration

Config file schema:

```yaml
version: "3.0"
pipelines:
  feature: [NEW, ACTIVE, CLOSED]
  task: [NEW, ACTIVE, CLOSED]
```

Optional pipeline states supported by catalog order:
- Feature: `READY_TO_PROD`
- Task: `TO_BE_TESTED`, `READY_TO_PROD`

Important rules:
- Pipelines must start with `NEW`.
- Pipelines must include `ACTIVE`.
- Pipelines must end with `CLOSED`.
- `WILL_NOT_IMPLEMENT` is always valid as exit state and must not be listed in pipeline arrays.

Config lock behavior:
- Before workflow data exists, pipeline config is mutable.
- After data exists, pipeline is locked in DB (`_pipeline_config`) and file edits are ignored.
- Use `sync` with `override: true` to rotate DB and adopt new pipelines.

## Data Semantics and Concurrency

### IDs

- UUID v4, stored as 32-char lowercase dashless hex.
- Tool UUID input accepts dashed or dashless; normalized internally.

### Optimistic Locking

- Mutable entities include `version`.
- Write operations requiring consistency checks will fail on version mismatch.

### Blocking Special Token

`NO_OP` is a manual blocker token:
- Use when an item is blocked by external factors, not another entity.
- Requires `blockedReason` on `block`.
- Removing `NO_OP` via `unblock` clears `blockedReason` when no `NO_OP` remains.

## Workflow Side Effects

### Advance (`advance`)

- Moves one step forward in pipeline.
- Refuses if blocked or terminal.
- If item reaches `CLOSED`, dependents blocked by it are auto-unblocked.
- Task->feature side effects:
  - First task `NEW -> ACTIVE` can auto-advance feature `NEW -> ACTIVE`.
  - When all sibling tasks become terminal:
    - all `WILL_NOT_IMPLEMENT` -> feature `WILL_NOT_IMPLEMENT`
    - all closed or mixed terminal with >=1 closed -> feature `CLOSED`

### Terminate (`terminate`)

- Moves item to `WILL_NOT_IMPLEMENT`.
- Bypasses blocked checks.
- Does not auto-unblock dependents.
- Returns affected dependents so the agent can reassess explicitly.
- Task termination can trigger feature side effects when all sibling tasks are terminal.

### Revert (`revert`)

- Moves one step backward in pipeline.
- Not allowed from terminal states.

## MCP Tool Catalog

Total tools exposed by server:
- Container CRUD/search: `query_container`, `manage_container`
- Sections: `query_sections`, `manage_sections`
- Templates: `query_templates`, `manage_template`, `apply_template`
- Tags: `list_tags`, `get_tag_usage`, `rename_tag`
- Queue and blocked insights: `get_next_task`, `get_blocked_tasks`, `get_next_feature`, `get_blocked_features`
- Workflow/dependencies: `query_workflow_state`, `query_dependencies`, `manage_dependency`
- Pipeline control: `advance`, `revert`, `terminate`, `block`, `unblock`
- Knowledge graph: `query_graph`, `manage_graph`, `manage_changelog`
- Ops: `sync`

### Container Tools

#### `query_container`
Read operations for `project`, `feature`, `task`.

Operations:
- `get` by ID
- `search` with filters
- `overview` global or scoped hierarchy view

Key params:
- `operation`, `containerType`, `id`
- filters: `query`, `status`, `priority`, `tags`, `projectId`, `featureId`
- pagination: `limit`, `offset`
- `includeSections` (for `get`)
- `includeGraphContext` (for task `get` — automatically resolves knowledge graph context from the task's Context Files section)

#### `manage_container`
Write operations for `project`, `feature`, `task`.

Operations:
- `create`
- `update`
- `delete`

Important constraints:
- Status cannot be changed through this tool.
- Use `advance` / `revert` / `terminate` for state transitions.
- `update` requires `version`.

### Section Tools

#### `query_sections`
Retrieves sections for `PROJECT`, `FEATURE`, `TASK`.

Supports:
- `includeContent` toggle for token savings
- filtering by `tags` and `sectionIds`

#### `manage_sections`
Section lifecycle operations:
- `add`, `update`, `updateText`, `delete`, `reorder`, `bulkCreate`, `bulkDelete`

Supports optimistic locking on update operations via `version`.

### Template Tools

#### `query_templates`
Operations:
- `get` template (optional sections)
- `list` with filters

Filters:
- `targetEntityType`, `isBuiltIn`, `isEnabled`, `tags`

#### `manage_template`
Operations:
- `create`, `update`, `delete`, `enable`, `disable`, `addSection`

Notes:
- Protected templates cannot be modified/deleted.

#### `apply_template`
Applies template sections onto `PROJECT`/`FEATURE`/`TASK` entity.

### Tag Tools

- `list_tags`: all tags with usage counts
- `get_tag_usage`: entities using a tag
- `rename_tag`: rename globally, supports `dryRun`

### Queue/Blocked Insight Tools

#### `get_next_task`
Returns next recommended task:
- status `NEW`
- unblocked (`blocked_by = []`)
- sorted by priority, then complexity, then oldest

Optional filters: `projectId`, `featureId`, `priority`

#### `get_next_feature`
Returns next recommended feature:
- status in `ACTIVE`/`NEW`
- unblocked
- prioritizes continuing active work before new work

Optional filters: `projectId`, `priority`

#### `get_blocked_tasks` / `get_blocked_features`
List blocked entities (`blocked_by != []`) with optional scope filters.

### Workflow and Dependency Tools

#### `query_workflow_state`
For `feature`/`task` only. Returns:
- current status
- next/previous status
- terminal flag
- blocked state and blockers
- pipeline position
- related entities

#### `manage_dependency`
Create/delete cross-entity links:
- `BLOCKS`
- `RELATES_TO`

Supports `task <-> feature` combinations.

#### `query_dependencies`
Read dependencies/dependents for `task` or `feature`.

Direction:
- `dependencies`
- `dependents`
- `both`

### Pipeline Control Tools

#### `advance`
One-step forward transition with validation and side effects.

Requires:
- `containerType` (`task` or `feature`)
- `id`
- `version`

When a task reaches a completion terminal state (not `WILL_NOT_IMPLEMENT`), the response includes `graphHints` suggesting knowledge graph updates for the affected areas.

#### `revert`
One-step backward transition.

Requires:
- `containerType`
- `id`
- `version`

#### `terminate`
Exit transition to `WILL_NOT_IMPLEMENT`.

Requires:
- `containerType`
- `id`
- `version`

Optional:
- `reason`

#### `block`
Attach blockers to a task/feature.

Input:
- `blockedBy`: array of entity UUIDs or `NO_OP`
- `blockedReason`: required for `NO_OP`

Idempotent merge behavior.

#### `unblock`
Remove specific blockers.

Input:
- `blockedBy`: array of blocker UUIDs to remove or `NO_OP`

Idempotent removal behavior.

### Operations Tool

#### `sync`
Ensures orchestrator runtime state:
- creates config if missing
- runs migrations
- initializes config

If DB already has data:
- returns warning unless `override: true`
- with override, backs up current DB as deprecated timestamp file
- initializes fresh DB in place

### Knowledge Graph Tools

The knowledge graph provides persistent, file-path-indexed codebase knowledge that agents can read and write across sessions. It organizes knowledge into a two-level hierarchy of molecules (domains/systems) and atoms (modules/components), with atoms linked to files via glob patterns.

#### Data Model

- `molecule` — a high-level grouping (e.g., "Repository Layer", "Auth System"). Contains knowledge about the domain, related molecules, and member atoms.
- `atom` — a knowledge unit mapped to files via glob patterns (e.g., `src/repos/graph-*.ts`). Contains knowledge about how the files work, related atoms, and changelog entries.
- `changelog` — immutable entries recording what changed in an atom or molecule, linked to the task that made the change.

All graph entities are scoped to a project. Atoms may optionally belong to a molecule. Atoms without a molecule are "orphans."

#### `query_graph`

Read operations for the knowledge graph.

Operations:
- `get` — retrieve a single atom or molecule by ID, with optional changelog
- `search` — filtered list of atoms or molecules within a project
- `context` — match comma-separated file paths against atom glob patterns, return hierarchical context grouped by molecule

Key params:
- `operation`, `entityType` (`atom` or `molecule`)
- `id` (for `get`)
- `projectId`, `query`, `moleculeId`, `orphansOnly` (for `search`)
- `paths` (comma-separated file paths, for `context`)
- `includeChangelog`, `changelogLimit`

The `context` operation is the primary read path for agents. Given a set of file paths, it returns all matching atoms grouped under their molecules, with knowledge and recent changelog. Unmatched paths and orphan atoms are reported separately.

#### `manage_graph`

Write operations for the knowledge graph.

Operations:
- `create` — create a new atom or molecule
- `update` — modify fields (uses optimistic locking via `version`)
- `delete` — remove an entity (uses optimistic locking via `version`)

Key params:
- `operation`, `entityType`
- `projectId`, `name`, `knowledge`, `paths` (JSON array of globs), `moleculeId`, `createdByTaskId` (for `create`)
- `id`, `version`, `name`, `knowledge`, `knowledgeMode` (`overwrite` or `append`), `paths`, `moleculeId`, `lastTaskId`, `relatedAtoms`, `relatedMolecules` (for `update`)
- `id`, `version`, `cascade` (for `delete` — cascade deletes member atoms, otherwise orphans them)

Validation rules:
- Paths: max 20 per atom, max 512 chars each, no leading `/`, no `..` traversal
- Knowledge: max 32KB
- Name: max 255 chars
- Related entries: max 50 per entity
- Atoms must belong to the same project as their molecule

#### `manage_changelog`

Append and search changelog entries.

Operations:
- `append` — create a new immutable changelog entry
- `search` — list entries for an atom or molecule, ordered by newest first

Key params:
- `operation`, `parentType` (`atom` or `molecule`), `parentId`
- `taskId`, `summary` (for `append`)
- `limit`, `offset` (for `search`)

#### Graph Integration with Workflow

The knowledge graph integrates with the orchestrator workflow at two points:

1. **Task fetch** — `query_container` with `includeGraphContext: true` on a task `get` operation automatically reads the task's Context Files section, extracts file paths, matches them against atom glob patterns, and returns the hierarchical graph context alongside the task data. No separate `query_graph` call needed.

2. **Task completion** — `advance` returns `graphHints` when a task reaches a completion terminal state, suggesting the agent update atom knowledge, paths, and changelog for areas affected by the completed work.

## Recommended Agent Usage Pattern

1. Create or fetch work item with `manage_container` / `query_container`.
2. Use `block`/`manage_dependency` when dependency constraints are identified.
3. Fetch tasks with `includeGraphContext: true` to get relevant codebase knowledge.
4. Use `advance` to move forward, never direct status mutation.
5. After task completion, update the knowledge graph (atom knowledge, paths, changelog) for areas affected by the work.
6. Use `terminate` only when work is explicitly abandoned and process affected dependents returned by tool output.
7. Use `query_workflow_state` before major state decisions.

## Example MCP Calls

### Create a feature

```json
{
  "name": "manage_container",
  "arguments": {
    "operation": "create",
    "containerType": "feature",
    "projectId": "6f9c6d5fbd5d4ef7a6e3b4f77234a8d1",
    "name": "Pipeline Tooling",
    "summary": "Build linear transition tools",
    "priority": "HIGH",
    "tags": "workflow,pipeline"
  }
}
```

### Advance a task safely

```json
{
  "name": "advance",
  "arguments": {
    "containerType": "task",
    "id": "4f7ed4d3f1ab472e9c5f7f7488c104d9",
    "version": 3
  }
}
```

### Block with external dependency (`NO_OP`)

```json
{
  "name": "block",
  "arguments": {
    "containerType": "task",
    "id": "4f7ed4d3f1ab472e9c5f7f7488c104d9",
    "version": 4,
    "blockedBy": "NO_OP",
    "blockedReason": "Waiting for vendor security review"
  }
}
```

### Fetch task with graph context

```json
{
  "name": "query_container",
  "arguments": {
    "operation": "get",
    "containerType": "task",
    "id": "a2d79a63bb4043fabef883335c076ecc",
    "includeSections": true,
    "includeGraphContext": true
  }
}
```

### Create a knowledge graph atom

```json
{
  "name": "manage_graph",
  "arguments": {
    "operation": "create",
    "entityType": "atom",
    "projectId": "6f9c6d5fbd5d4ef7a6e3b4f77234a8d1",
    "moleculeId": "097301b2db15495e97bdab2cabe0a960",
    "name": "Graph Repos",
    "paths": "[\"src/repos/graph-*.ts\"]",
    "knowledge": "Three repo files for graph CRUD operations",
    "createdByTaskId": "a2d79a63bb4043fabef883335c076ecc"
  }
}
```

### Query graph context by file paths

```json
{
  "name": "query_graph",
  "arguments": {
    "operation": "context",
    "projectId": "6f9c6d5fbd5d4ef7a6e3b4f77234a8d1",
    "paths": "src/repos/graph-atoms.ts,src/repos/graph-molecules.ts"
  }
}
```

### Terminate and inspect impacted dependents

```json
{
  "name": "terminate",
  "arguments": {
    "containerType": "feature",
    "id": "c57ea2a8bfca4e5ea6541018ae7f95b0",
    "version": 7,
    "reason": "Scope removed"
  }
}
```

## Testing

```bash
bun test
```

## Development Scripts

- Start: `bun run src/server.ts`
- Watch mode: `bun --watch run src/server.ts`
- Tests: `bun test`

## Package Metadata

NPM package:
- `@allpepper/task-orchestrator`

Binary entry:
- `task-orchestrator` -> `src/server.ts`

## Compatibility Notes

This v3 design differs from event-driven orchestration engines:
- It emphasizes explicit, linear state movement.
- It avoids target-state mutation APIs for agent safety.
- It models blocking as first-class data fields with deterministic side effects.

If you need strict deterministic automation with lower agent reasoning overhead, this model is the intended path.
