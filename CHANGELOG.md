# [3.0.0](https://github.com/alioshr/task-orchestrator/compare/v2.0.0...v3.0.0) (2026-02-08)


* fix!: safe server bootstrap, remove DATABASE_PATH, rename init to sync ([b510063](https://github.com/alioshr/task-orchestrator/commit/b5100635ecac85e5106cedfd6adb227fc3067a02))


### BREAKING CHANGES

* DATABASE_PATH env no longer supported. init tool renamed to sync, confirmed param renamed to override.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

# [2.0.0](https://github.com/alioshr/task-orchestrator/compare/v1.2.1...v2.0.0) (2026-02-08)


* feat!: v3 pipeline and blocking refactor ([fdb7e52](https://github.com/alioshr/task-orchestrator/commit/fdb7e52faf0d218478d7eebdd0a6877274288e37))


### BREAKING CHANGES

* v3 is a complete pipeline and dependency model rewrite.
All legacy statuses are remapped. The dependencies table is dropped in
favor of blocked_by/related_to JSON fields. manage_container no longer
supports setStatus. Projects lose their status column.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

# 3.0.0 (Breaking)

### Breaking Changes

* Projects are now stateless boards (no status column or workflow transitions)
* Feature and task status follows lean configurable pipelines (NEW → ACTIVE → ... → CLOSED)
* WILL_NOT_IMPLEMENT replaces CANCELLED as the exit/terminal state
* Blocking is now a first-class field (blockedBy/blockedReason) instead of a status
* Dependencies table removed; blocking and relations stored as JSON fields on entities
* `setup_project` tool removed
* `get_next_status` tool removed
* `manage_container` no longer supports `setStatus` operation or `status` in update
* `IS_BLOCKED_BY` dependency type removed
* Database migration 003 required (auto-applied on boot)

### New Tools

* `init` - Initialize orchestrator (config + DB), with re-init safety
* `advance` - Move entity one step forward in pipeline
* `revert` - Move entity one step backward in pipeline
* `terminate` - Set entity to WILL_NOT_IMPLEMENT
* `block` - Block entity with UUID blockers or NO_OP
* `unblock` - Remove specific blockers from entity

### Changed Tools

* `manage_dependency` - Now supports only BLOCKS and RELATES_TO (IS_BLOCKED_BY removed)
* `get_next_task` - Filters by NEW status and empty blocked_by
* `get_next_feature` - Prioritizes ACTIVE over NEW, filters unblocked
* `get_blocked_tasks` / `get_blocked_features` - Use blocked_by field semantics
* `query_workflow_state` - Returns lean payload with pipeline position

### Configuration

* Config file format: YAML at TASK_ORCHESTRATOR_HOME/config.yaml
* Pipelines are configurable with optional states (TO_BE_TESTED, READY_TO_PROD)
* Pipeline immutability enforced after data exists
* Startup checks warn about entities in states not in active pipeline

## [1.2.1](https://github.com/alioshr/task-orchestrator/compare/v1.2.0...v1.2.1) (2026-02-07)


### Bug Fixes

* normalize IS_BLOCKED_BY to BLOCKS at write time in createDependency ([a30979b](https://github.com/alioshr/task-orchestrator/commit/a30979b7f6fd1bbbbcf347afd10bc28f1731c25d))

# [1.2.0](https://github.com/alioshr/task-orchestrator/compare/v1.1.3...v1.2.0) (2026-02-07)


### Features

* generalize dependency enforcement to all container types ([7110a46](https://github.com/alioshr/task-orchestrator/commit/7110a4612cb6315bad7b716e69c326ea36af0ca2))

## [1.1.3](https://github.com/alioshr/task-orchestrator/compare/v1.1.2...v1.1.3) (2026-02-07)


### Bug Fixes

* accept both dashed and dashless UUIDs in tool input schemas ([370de12](https://github.com/alioshr/task-orchestrator/commit/370de12def1ad2d14227bc5636ef699c5c8c5304))

## [1.1.2](https://github.com/alioshr/task-orchestrator/compare/v1.1.1...v1.1.2) (2026-02-07)


### Bug Fixes

* auto-derive projectId from feature when creating tasks ([78b852d](https://github.com/alioshr/task-orchestrator/commit/78b852db3bb4068e6eef288bba4c825b90a0aaf0))

## [1.1.1](https://github.com/alioshr/task-orchestrator/compare/v1.1.0...v1.1.1) (2026-02-07)


### Bug Fixes

* cascade delete tasks under features without project_id ([108dfd4](https://github.com/alioshr/task-orchestrator/commit/108dfd492f9202fbf64bf9704d4dd02d4d2c5cac))

# [1.1.0](https://github.com/alioshr/task-orchestrator/compare/v1.0.3...v1.1.0) (2026-02-07)


### Features

* add cascade delete for projects and features ([0bee85f](https://github.com/alioshr/task-orchestrator/commit/0bee85f2be0c9dd625a0cd37deeb15c60eb30bc2))

## [1.0.3](https://github.com/alioshr/task-orchestrator/compare/v1.0.2...v1.0.3) (2026-02-07)


### Bug Fixes

* add shebang for npx/bunx compatibility ([63a474a](https://github.com/alioshr/task-orchestrator/commit/63a474adba015f69d1dcdd97446bf07fc7324eca))

## [1.0.2](https://github.com/alioshr/task-orchestrator/compare/v1.0.1...v1.0.2) (2026-02-07)


### Bug Fixes

* export domain types from barrel export ([2571238](https://github.com/alioshr/task-orchestrator/commit/25712382bbd44242679dba8083f0fdc2d4a14000))

## [1.0.1](https://github.com/alioshr/task-orchestrator/compare/v1.0.0...v1.0.1) (2026-02-07)


### Bug Fixes

* update npm for OIDC support and remove registry-url conflict ([67f2735](https://github.com/alioshr/task-orchestrator/commit/67f2735ef6e05db21bc8e98c0cf6cfd394b21662))

# 1.0.0 (2026-02-07)


### Bug Fixes

* run migrations before tests in CI ([82125d3](https://github.com/alioshr/task-orchestrator/commit/82125d36653316233aaa96114d1c84eb7eba5fcc))
* split semantic-release and npm publish for OIDC ([133c801](https://github.com/alioshr/task-orchestrator/commit/133c80114f3836726423c8e7c77786ff4ead8df7))
* use OIDC for npm auth instead of token ([aef3572](https://github.com/alioshr/task-orchestrator/commit/aef3572a1ef5696ef9dc9627f9da6bf183bc478e))


### Features

* configure npm publishing with semantic-release ([f059b95](https://github.com/alioshr/task-orchestrator/commit/f059b955006366dbd1b010f4f0f8609861f0eb09))
