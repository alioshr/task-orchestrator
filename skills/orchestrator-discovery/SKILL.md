---
name: orchestrator-discovery
description: Use when starting a session, resuming work, or asking what is active in the current repository
---

# Orchestrator Discovery

Surface current work state from MCP Task Orchestrator before taking action.

## Workflow

1. Get current repository/directory name
2. Query projects matching that name
3. If not found: prompt user to create project, stop here
4. If found: report status, get next task
5. Fetch the next task with graph context (single call resolves both)
6. Present project status, next task, and graph context to user

## MCP Tools

**Search for project by repo name:**
```
query_container
  operation: "search"
  containerType: "project"
  query: "<repo-name>"
```

**Get project overview with features/tasks:**
```
query_container
  operation: "overview"
  containerType: "project"
  id: <project-uuid>
```

**Get next available task:**
```
get_next_task
  projectId: <project-uuid>
```

**Fetch task with sections and graph context (single call):**
```
query_container
  operation: "get"
  containerType: "task"
  id: <task-uuid>
  includeSections: true
  includeGraphContext: true
```

The `includeGraphContext` parameter automatically reads the task's Context Files section, extracts file paths, matches them against atom glob patterns, and returns the hierarchical graph context in the response. No separate `query_graph` call is needed.

## Graph Context Rules

- Only request graph context if a next task exists.
- If the task has no Context Files section or no matching atoms, `graphContext` will be absent from the response — this is normal.
- If `graphContext` contains `unmatchedPaths`, mention them — these are files the task will touch that no atom covers yet.
- If `graphContext` contains `orphanAtoms`, note which atoms lack a molecule grouping.
- Do NOT write to the graph during discovery. Discovery is read-only.

## Output

**If project found with graph context:**
```
Project: <name> (<status>)
- Feature A (ACTIVE): 3/5 tasks done
- Feature B (NEW): blocked

Next task: <title>

Graph context:
  <Molecule>: <molecule knowledge summary>
    <Atom>: <atom knowledge summary>
      matched: file-a.ts, file-b.ts
      related: <other atom> — <reason>
  Orphan atoms: <atoms with no molecule>
  Unmatched files: <files no atom covers>

Shall I start on this?
```

**If project found without graph context (no Context Files or no graph data):**
```
Project: <name> (<status>)
- Feature A (ACTIVE): 3/5 tasks done

Next task: <title>
Shall I start on this?
```

**If no project found:**
```
No project found for "<repo-name>".
Create one to start tracking work?
```
