---
name: orchestrator-execution
description: Use after discovery when ready to execute planned work, to delegate tasks to agents and manage status progression
---

# Orchestrator Execution

Execute planned tasks, manage workflow status, and update the knowledge graph with what was learned.

## Workflow

1. Fetch task with sections and graph context (single call)
2. Dispatch to recommended agent with task context + graph context
3. Wait for completion (never interrupt)
4. Run verification commands
5. If failed: keep IN_PROGRESS, surface issue, stop here
6. If passed: update the knowledge graph
7. Advance status
8. Check siblings, suggest next task

## MCP Tools

**Fetch task with sections and graph context:**
```
query_container
  operation: "get"
  containerType: "task"
  id: <task-uuid>
  includeSections: true
  includeGraphContext: true
```

**Query workflow state (REQUIRED before status change):**
```
query_workflow_state
  containerType: "task"
  id: <task-uuid>
```

**Advance status:**
```
advance
  containerType: "task"
  id: <task-uuid>
  version: <version-from-workflow-state>
```

**Get next task:**
```
get_next_task
  featureId: <feature-uuid>
```

## Context to Pass to Sub-Agents

Include these sections verbatim:
- Implementation Plan
- Context Files
- Verification
- Dependencies and Constraints

Also include the `graphContext` from the query response. Format it as a readable summary at the top of the agent prompt:

```
Knowledge graph context for this task:

Molecule: <name> — <knowledge>
  Atom: <name> — <knowledge>
    matched: file-a.ts, file-b.ts
    related: <other atom> — <reason>
Orphan atoms: <atoms matched but ungrouped>
Unmatched files: <files in Context Files no atom covers>
```

## Status Rules

Never skip statuses. Always:
1. Call query_workflow_state first
2. Only use status from allowedTransitions
3. Pass version field

Typical flow: `NEW -> ACTIVE -> CLOSED` (configurable via `config.yaml` pipelines)

## Agent Defaults

| Work Type | Agent / Model |
|-----------|---------------|
| Simple implementation | sonnet |
| Complex implementation | opus |
| Test writing | sonnet |
| Exploration | Explore / haiku |
| Code review | code-reviewer / sonnet |

## Graph Update After Verification (REQUIRED)

After verification passes and before advancing status, update the knowledge graph. This is not optional — the skill enforces it.

### Step 1 — Identify affected atoms

Check which atoms match the files touched during the task. Use `query_graph context` if not already loaded, or reference the `graphContext` from step 1.

### Step 2 — Update atom knowledge

If the work changed how the area works (new patterns, new constraints, changed integration points):

```
manage_graph
  operation: "update"
  entityType: "atom"
  id: <atom-uuid>
  knowledgeMode: "append" | "overwrite"
  knowledge: "<what changed about this area>"
  lastTaskId: <task-uuid>
  version: <current-version>
```

Use `append` for incremental additions. Use `overwrite` after major refactors.

### Step 3 — Update atom paths

If files were moved, new directories created, or the atom's boundary changed:

```
manage_graph
  operation: "update"
  entityType: "atom"
  id: <atom-uuid>
  paths: '["src/new/path/**"]'
  lastTaskId: <task-uuid>
  version: <current-version>
```

### Step 4 — Create new atoms for uncovered areas

If the task created files in an area no atom covers (visible from `unmatchedPaths`):

```
manage_graph
  operation: "create"
  entityType: "atom"
  projectId: <project-uuid>
  moleculeId: <molecule-uuid if applicable>
  name: "<area name>"
  paths: '["src/new/area/**"]'
  knowledge: "<how this area works, patterns, constraints>"
  createdByTaskId: <task-uuid>
```

### Step 5 — Update related atoms

If the work revealed or changed connections between atoms:

```
manage_graph
  operation: "update"
  entityType: "atom"
  id: <atom-uuid>
  relatedAtoms: '[{ "atomId": "...", "reason": "consumes events from" }]'
  lastTaskId: <task-uuid>
  version: <current-version>
```

### Step 6 — Append changelog entries for significant changes

```
manage_changelog
  operation: "append"
  parentType: "atom"
  parentId: <atom-uuid>
  taskId: <task-uuid>
  summary: "<what changed and why>"
```

Not every atom update needs a changelog entry. Use judgment:
- Minor knowledge tweaks: skip, the `knowledgeMode=append` separator traces it
- New atom created: skip, `createdByTaskId` traces it
- Meaningful behavior changes: log it
- Changed integration points between atoms: log it

### Step 7 — Advance status

After graph updates are complete, proceed with status advancement:

```
query_workflow_state
  containerType: "task"
  id: <task-uuid>
```

```
advance
  containerType: "task"
  id: <task-uuid>
  version: <version>
```

## After Task Completion

1. Check if all sibling tasks complete
2. If yes: prompt to advance feature status
3. Suggest next task
