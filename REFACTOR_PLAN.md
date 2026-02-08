# Task Orchestrator v3: Pipeline and Blocking Refactor

## Purpose

The current model has too many human-process states and split blocking semantics. v3 is a breaking simplification for AI-agent execution:
- lean linear pipelines
- blocking stored as first-class fields
- single-step status tools (advance/revert/terminate/block/unblock)
- explicit handling of abandoned work (`WILL_NOT_IMPLEMENT`)

## Source-of-Truth Decisions

1) Pipelines are predefined catalogs, config selects active states.
2) Blocking is a field (`blockedBy`, `blockedReason`), not a status.
3) Blocking input contract is strict: `blockedBy` is either `UUID[]` (dashless) or string `NO_OP`.
4) `blockedBy = "NO_OP"` requires `blockedReason`.
5) `CLOSED` and `WILL_NOT_IMPLEMENT` are terminal and immutable (no transitions out).
6) `terminate` to `WILL_NOT_IMPLEMENT` does NOT auto-unblock dependents.
7) Auto-unblock happens only when work is completed by reaching `CLOSED` via pipeline advance.
8) If all child tasks of a feature are `WILL_NOT_IMPLEMENT`, the feature becomes `WILL_NOT_IMPLEMENT`.
9) `setup_project` is removed entirely.
10) Major-version breaking migration.
11) Home path is `TASK_ORCHESTRATOR_HOME` (default `~/.task-orchestrator/`) for DB/config, with `DATABASE_PATH` override preserved.
12) `RELATES_TO` stays for reference links and must support task-feature linking.

## State Model

Feature pipeline:
`NEW -> ACTIVE -> READY_TO_PROD -> CLOSED`

Task pipeline:
`NEW -> ACTIVE -> TO_BE_TESTED -> READY_TO_PROD -> CLOSED`

Project:
Stateless container/board (no status column, no workflow transitions).

Exit state:
`WILL_NOT_IMPLEMENT` for tasks and features, callable from any current pipeline state.

Pipeline minimum constraints:
- first state
- `ACTIVE`
- terminal pipeline state (`CLOSED`)

Transition constraints:
- `advance` and `revert` are one-step transitions only (no skipping).
- no transition is allowed from `CLOSED` or `WILL_NOT_IMPLEMENT`.

## Config and Init Lifecycle (Final)

Config file format:
```yaml
version: "3.0"
pipelines:
  feature: [NEW, ACTIVE, CLOSED]
  task: [NEW, ACTIVE, CLOSED]
```

Optional states:
- `READY_TO_PROD` is optional for features and tasks.
- `TO_BE_TESTED` is optional for tasks.
- init-generated config must include comments explaining these optional states and how to enable them before data exists.

Bootstrap behavior:
- `init` creates DB and config file.
- after `init`, tool response must tell the LLM that optional states can be added if needed (before data exists).
- server loads pipelines from config.

Immutability after data exists:
- once DB has stored records, pipeline edits in config are ignored.
- reconfiguration requires explicit re-initialization workflow.

Re-init safety:
- if `init` is called and DB already has records, return warning and do nothing unless called again with `confirmed: true`.
- when `confirmed: true`, rename existing DB to a deprecated backup and create a fresh DB.
- recommended deprecated filename pattern: `tasks.db.deprecated-YYYYMMDD-HHmmss.sqlite`.
- no automatic data migration between deprecated and fresh DB; user handles migration manually.

## Blocking and Dependency Model

Blocking fields on tasks/features:
- `blocked_by` JSON array in DB, exposed as `blockedBy` in API
- `blocked_reason` nullable text, exposed as `blockedReason`

Blocking semantics:
- blocked entities cannot `advance`
- `terminate` bypasses blocked checks
- `unblock` only removes explicit blockers requested

## Blocking Input Rules (Final)

This section is the canonical rule for blocking input validation.

`blockedBy` accepted shapes:
- array of UUID strings (dashless format only)
- string literal `NO_OP`

Validation rules:
- If `blockedBy` is an array, every item must be a valid dashless UUID.
- If `blockedBy` is an array, every UUID must reference an existing task or feature ID.
- If `blockedBy` is an array of UUIDs, `blockedReason` is optional.
- If `blockedBy` is `NO_OP`, `blockedReason` is mandatory.
- Any other value for `blockedBy` is invalid.
- Any non-UUID value inside a UUID array is invalid.
- Any UUID in `blockedBy` that does not exist must be rejected.

Persistence normalization:
- Store `blocked_by` as a JSON array in all cases.
- If input is `blockedBy = "NO_OP"`, persist as `blocked_by = ["NO_OP"]`.
- If input is `blockedBy = [uuid1, uuid2, ...]`, persist that array as-is.

Error behavior:
- invalid `blockedBy` shape or invalid UUID content must return a validation error
- non-existent UUIDs in `blockedBy` must return a validation error
- `blockedBy = NO_OP` without `blockedReason` must return a validation error

Dependency types:
- Keep `BLOCKS`
- Keep `RELATES_TO`
- Remove `IS_BLOCKED_BY`

Reference linking:
- `RELATES_TO` is used for context links
- must support cross-entity linking (task<->feature, feature<->task, task<->task, feature<->feature)
- surface related entities in workflow/query responses

## Auto-Unblock Rules (Final)

On `advance` only:
- if resulting state is terminal pipeline state (`CLOSED`), remove this entity UUID from others’ `blockedBy`

On `terminate` (`WILL_NOT_IMPLEMENT`):
- do NOT auto-unblock
- query dependents blocked by this entity and return them as `affectedDependents`
- message must explicitly instruct reassessment of affected dependents

Rationale:
- `CLOSED` means completed work, safe to auto-unblock
- `WILL_NOT_IMPLEMENT` means abandoned work, requires explicit agent decision

## Feature Transition Side-Effects (Final)

This section is the canonical rule for feature status changes driven by task status changes.

Activation rule:
- if parent feature is `NEW` and any child task moves `NEW -> ACTIVE`, feature moves to `ACTIVE`.

Closure rules:
- if all child tasks are `CLOSED`, feature moves to `CLOSED` and triggers feature auto-unblock.
- if all child tasks are `WILL_NOT_IMPLEMENT`, feature moves to `WILL_NOT_IMPLEMENT`.
- if all child tasks are exited and the set contains at least one `CLOSED`, feature moves to `CLOSED`.

## Tool Contract (v3)

New tools:
- `init { confirmed?: boolean }`
- `advance { containerType, id, version }`
- `revert { containerType, id, version }`
- `terminate { containerType, id, version, reason? }`
- `block { containerType, id, version, blockedBy, blockedReason? }`
- `unblock { containerType, id, version, blockedBy }`

Scope rules:
- workflow tools support `task` and `feature` only
- project has no workflow tools

Write tool response contract:
- all write tools return updated entity state and updated `version`
- transition tools also return a short actionable message for the agent

`advance`:
- refuse when blocked
- compute next state from configured pipeline
- trigger auto-unblock only when landing on `CLOSED`
- enforce Feature Transition Side-Effects (Final)

`revert`:
- move one step backward in pipeline
- refuse at first pipeline state
- refuse from terminal states (`CLOSED`, `WILL_NOT_IMPLEMENT`)

`terminate`:
- set `WILL_NOT_IMPLEMENT` from any pipeline state
- skip blocked checks
- preserve entity’s own `blockedBy` and `blockedReason`
- return `affectedDependents` if this entity blocks others
- does not auto-unblock
- enforce Feature Transition Side-Effects (Final)

`block`:
- enforce the Blocking Input Rules (Final)
- for UUID blockers, each blocker entity must exist and not be terminal (`CLOSED` or `WILL_NOT_IMPLEMENT`)
- idempotent insertion into `blockedBy`

`unblock`:
- remove requested blocker entry or entries from `blockedBy`
- idempotent behavior: success even if requested blocker is already absent
- clear `blockedReason` only when `blockedBy` no longer contains `NO_OP`

## Existing Tools Changes

Remove:
- `get_next_status`
- `setup_project`

Keep with changes:
- `manage_container`: remove `setStatus`, reject `status` in `update`
- `manage_dependency`: remove `IS_BLOCKED_BY`
- `get_next_task`: use `NEW` and `blocked_by = []`, ordered by priority, complexity, then oldest `created_at`
- `get_next_feature`: include `ACTIVE` continuation and `NEW`, ordered by priority then oldest `created_at`
- `get_blocked_tasks` and `get_blocked_features`: use `blocked_by` field semantics
- `query_workflow_state`: return lean payload

`query_workflow_state` target payload:
`{ currentStatus, nextStatus, prevStatus, isTerminal, isBlocked, blockedBy, blockedReason, pipelinePosition, relatedEntities }`

## Phase Plan

### Phase 1: Config and Home Path

Create:
- `src/config/types.ts`
- `src/config/catalog.ts`
- `src/config/index.ts`

Modify:
- `src/db/client.ts` to resolve DB path from `TASK_ORCHESTRATOR_HOME`, with `DATABASE_PATH` override

Verify:
- `bun test src/config/`

### Phase 2: Domain Types and Status Validator

Modify:
- `src/domain/types.ts`
  - remove project status enum and project status field
  - update feature/task enums to v3 states
  - add blocked fields for task/feature
  - remove `DependencyType.IS_BLOCKED_BY`
- `src/services/status-validator.ts` config-driven next/prev
- `src/services/workflow.ts` lean workflow state payload
- tests in `src/services/*.test.ts`

Verify:
- `bun test src/services/`

### Phase 3: Migration 003 and Repository Refactor

Create:
- `src/db/migrations/003_simplify_pipeline_states.sql`

Modify:
- `src/db/migrate.ts` to include migration 003
- repositories for tasks/features/projects/dependencies

Migration outcomes:
- project status removed (stateless projects)
- map legacy feature/task states to new catalogs
- add `blocked_by` and `blocked_reason` columns to tasks/features
- remove `IS_BLOCKED_BY` usage

Note for `RELATES_TO`:
- ensure repository and schema support cross-entity links for reference relationships

Verify:
- `bun test src/repos/`
- fresh DB migration test from v2 data

### Phase 4: New Workflow and Blocking Tools

Create:
- `src/tools/advance.ts`
- `src/tools/revert.ts`
- `src/tools/terminate.ts`
- `src/tools/block.ts`
- `src/tools/unblock.ts`

Verify:
- `bun test src/tools/`
- integration tests for lifecycle and side effects

### Phase 5: Remove Obsolete Tooling and Wire Server

Modify:
- `src/tools/manage-container.ts`
- `src/tools/manage-dependency.ts`
- `src/tools/get-next-task.ts`
- `src/tools/get-next-feature.ts`
- `src/tools/get-blocked-tasks.ts`
- `src/tools/get-blocked-features.ts`
- `src/tools/query-workflow-state.ts`
- `src/tools/index.ts`
- `src/server.ts`

Delete:
- `src/tools/get-next-status.ts`
- `src/tools/setup-project.ts`

Verify:
- full `bun test`
- `bunx tsc --noEmit`

### Phase 6: Package and Exports

Modify:
- `src/index.ts` (export config module)
- `package.json` version `3.0.0`

Verify:
- `bun test`
- `bunx tsc --noEmit`

### Phase 7: Startup Validation

Create:
- `src/config/startup-checks.ts`

Modify:
- `src/server.ts` to run startup checks after config load and migrations

Behavior:
- warn (non-fatal) when DB contains states not present in active config pipeline

Verify:
- full test run
- manual restart scenario with pipeline changes

## End-to-End Verification Checklist

1. Fresh DB: create project, feature, task; advance through pipeline; close successfully.
2. Blocking: block task; `advance` fails; unblock; `advance` succeeds.
3. Completion auto-unblock: A blocks B, advance A to `CLOSED`, B becomes unblocked.
4. Termination behavior: A blocks B, terminate A to `WILL_NOT_IMPLEMENT`, B remains blocked, response returns `affectedDependents`.
5. Config: minimal pipeline `[NEW, ACTIVE, CLOSED]`, optional states not in pipeline are unreachable.
6. Migration: v2 DB maps correctly to v3 states and blocked fields.
7. Startup: config excludes existing state, startup logs warning without crash.

## Execution Checklist (Task List)

### Phase 1: Config and Home Path

- [ ] Add `src/config/types.ts` with `OrchestratorConfig` and pipeline types.
- [ ] Add `src/config/catalog.ts` with full state catalogs and minimum pipeline validator.
- [ ] Add `src/config/index.ts` with config loading, default generation, and transition helpers.
- [ ] Update `src/db/client.ts` to resolve DB/config home using `TASK_ORCHESTRATOR_HOME`.
- [ ] Keep `DATABASE_PATH` as explicit override.
- [ ] Add config unit tests for load defaults, validation, and transition-map helpers.
- [ ] Run `bun test src/config/`.

Definition of done:
- Config loads correctly with defaults.
- Invalid pipeline configurations fail fast with clear errors.
- DB path respects env precedence.

### Phase 2: Domain Types and Workflow Core

- [ ] Remove project status enum and project status field from domain model.
- [ ] Replace feature/task enums with v3 states including `WILL_NOT_IMPLEMENT`.
- [ ] Add `blockedBy` and `blockedReason` to task and feature domain interfaces.
- [ ] Remove `DependencyType.IS_BLOCKED_BY`.
- [ ] Rewrite status validator to be config-driven (`next`, `prev`, terminal checks).
- [ ] Rewrite workflow service to return lean workflow payload shape.
- [ ] Rewrite service tests to match v3 semantics.
- [ ] Run `bun test src/services/`.

Definition of done:
- No legacy state names remain in service/domain logic.
- Workflow service does not expose old transition-list behavior.

### Phase 3: Migration 003 and Repository Refactor

- [ ] Add `src/db/migrations/003_simplify_pipeline_states.sql`.
- [ ] In migration 003, map legacy task and feature statuses to v3 states.
- [ ] In migration 003, remove project status column and related constraints.
- [ ] In migration 003, add `blocked_by` and `blocked_reason` columns to tasks/features.
- [ ] Update migration runner to include migration 003.
- [ ] Refactor task repo defaults and persistence for `NEW` and blocking fields.
- [ ] Refactor feature repo defaults and persistence for `NEW` and blocking fields.
- [ ] Refactor project repo to stateless CRUD behavior.
- [ ] Refactor dependency repo to remove `IS_BLOCKED_BY` normalization/usage.
- [ ] Implement auto-unblock helper for completion path only.
- [ ] Ensure `RELATES_TO` supports cross-entity links for reference relationships.
- [ ] Update repository tests for new statuses, filters, and migration behavior.
- [ ] Run `bun test src/repos/`.

Definition of done:
- Fresh v3 DB schema is valid.
- v2-to-v3 migration transforms existing data correctly.
- Repositories persist and read blocking fields consistently.

### Phase 4: New Workflow and Blocking Tools

- [ ] Create `src/tools/advance.ts` with blocked checks and pipeline-step transition.
- [ ] Create `src/tools/revert.ts` with one-step rollback logic.
- [ ] Create `src/tools/terminate.ts` with `WILL_NOT_IMPLEMENT` behavior.
- [ ] In `terminate`, return `affectedDependents` and do not auto-unblock.
- [ ] Create `src/tools/block.ts` with strict `blockedBy` validation (`UUID[]` or `NO_OP`).
- [ ] Create `src/tools/unblock.ts` with targeted blocker removal logic.
- [ ] Implement task side-effects: feature auto-activate on first task start.
- [ ] Implement Feature Transition Side-Effects (Final): task `NEW -> ACTIVE` activates feature; all children `CLOSED` closes feature; all children `WILL_NOT_IMPLEMENT` terminates feature; mixed exited with at least one `CLOSED` closes feature.
- [ ] Add tool-level tests for happy paths and guard rails.
- [ ] Run `bun test src/tools/`.

Definition of done:
- `advance` auto-unblocks only when entering `CLOSED`.
- `terminate` never auto-unblocks and always reports blocked dependents when present.

### Phase 5: Remove Obsolete Tools and Wire Server

- [ ] Update `manage_container` to remove `setStatus`.
- [ ] Update `manage_container` to reject `status` in `update`.
- [ ] Update `manage_dependency` to remove `IS_BLOCKED_BY` enum value.
- [ ] Update `get_next_task` and `get_next_feature` semantics and descriptions.
- [ ] Update blocked-query tools to use blocking fields.
- [ ] Update `query_workflow_state` output to target v3 shape.
- [ ] Remove `get_next_status` export, registration, and file.
- [ ] Remove `setup_project` export, registration, and file.
- [ ] Register new tools in `src/tools/index.ts` and `src/server.ts`.
- [ ] Run full `bun test`.
- [ ] Run `bunx tsc --noEmit`.

Definition of done:
- Server only exposes v3 workflow tools.
- No dead tool registrations remain.

### Phase 6: Packaging and Exports

- [ ] Export config module from public entry point.
- [ ] Bump package version to `3.0.0`.
- [ ] Update release/changelog notes for breaking API and migration.
- [ ] Run `bun test`.
- [ ] Run `bunx tsc --noEmit`.

Definition of done:
- Public API and package metadata reflect v3.

### Phase 7: Startup Validation

- [ ] Add `src/config/startup-checks.ts`.
- [ ] Add startup scan for entities in states missing from active config pipeline.
- [ ] Emit warnings only (no fatal boot failure).
- [ ] Call startup checks from server boot after config load and migrations.
- [ ] Add tests for warning behavior.
- [ ] Run full `bun test`.

Definition of done:
- Startup warning system is active and non-blocking.

### Final Gate (Release Readiness)

- [ ] Run full end-to-end verification checklist in this document.
- [ ] Validate one migration run from real v2 snapshot.
- [ ] Validate one fresh-install run on empty DB.
- [ ] Confirm all removed tools are absent from MCP registration and docs.
- [ ] Confirm `terminate` behavior matches source-of-truth decision.
- [ ] Confirm `setup_project` is fully removed.
