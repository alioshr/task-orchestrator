---
name: orchestrator-planning
description: Use when user describes new work to do such as features, fixes, or improvements, after discussion and before implementation
---

# Orchestrator Planning

Create features and tasks in MCP Task Orchestrator after discussing requirements. Enrich plans with knowledge graph context and create graph structures for new areas.

## Templates

Templates define which sections each entity type should have. Always:
1. Query templates to get the template ID for the entity type
2. Apply template immediately after creating the entity
3. Query sections to see what was created
4. Fill each section with concrete content

## Writing Section Content

- Use plain text only in section content
- Do not use markdown headings, bullets, numbered lists, tables, or code fences inside section bodies
- Use real newlines, never escaped `\n` literals
- Keep content concise, direct, and execution-oriented
- Be specific: file paths, commands, concrete steps
- Implementation Plan should have actionable steps an agent can follow

## Agent Defaults (for Recommended Agent section)

| Work Type | Agent / Model |
|-----------|---------------|
| Simple implementation | sonnet |
| Complex implementation | opus |
| Test writing | sonnet |
| Exploration | Explore / haiku |
| Code review | code-reviewer / sonnet |

## Delegation

- Planning = creating structure only, do not execute
- Only delegate to agents if user explicitly asks to start execution
- If user says "plan this" or "break this down": plan only
- If user says "do this" or "implement": plan then use orchestrator-execution skill

## Workflow

1. If no project exists for repo: create one with repo name
2. Query template for PROJECT, apply it, fill sections
3. **Query the knowledge graph for the affected area** (before creating features/tasks)
4. Create feature under project
5. Query template for FEATURE, apply it, fill sections
6. Create tasks under feature
7. Query template for TASK, apply to each, fill sections — **use graph knowledge to enrich Implementation Plan and Context Files**
8. Set dependencies between sequential tasks
9. **Create graph structures for new areas** (molecules, atoms)
10. **Flag knowledge gaps** to the user
11. Validate order with get_next_task
12. Present plan summary to user

## Graph Integration During Planning

### Before creating features/tasks — Read the graph

Search for existing atoms and molecules related to the new work:

```
query_graph
  operation: "search"
  entityType: "atom"
  projectId: <project-uuid>
  query: "<keywords related to the new work>"
```

```
query_graph
  operation: "search"
  entityType: "molecule"
  projectId: <project-uuid>
  query: "<keywords>"
```

Search for orphan atoms that might belong to the new area:

```
query_graph
  operation: "search"
  entityType: "atom"
  projectId: <project-uuid>
  orphansOnly: true
```

Use what you find to:
- Write better Implementation Plan sections (reference known constraints, existing patterns)
- Write accurate Context Files sections (include files the graph shows are relevant)
- Avoid duplicating work already captured in the graph

### After creating tasks — Write to the graph

If the new work defines a new area of the codebase, create graph structures:

**Create molecule (if this is a new domain/system):**
```
manage_graph
  operation: "create"
  entityType: "molecule"
  projectId: <project-uuid>
  name: "<domain name>"
  knowledge: "<service boundaries, external deps, domain rules>"
  createdByTaskId: <first-task-uuid>
```

**Create atom (if this is a new module/subsystem):**
```
manage_graph
  operation: "create"
  entityType: "atom"
  projectId: <project-uuid>
  moleculeId: <molecule-uuid>
  name: "<module name>"
  paths: '["src/path/to/area/**"]'
  knowledge: "<how files work together, patterns, integration points>"
  createdByTaskId: <first-task-uuid>
```

**Reassign orphan atoms to a molecule:**
```
manage_graph
  operation: "update"
  entityType: "atom"
  id: <orphan-atom-uuid>
  moleculeId: <molecule-uuid>
  lastTaskId: <task-uuid>
  version: <current-version>
```

### Gap flagging

After planning, report to the user:
- Which files in the plan's Context Files have no matching atom (will be covered during execution)
- Which orphan atoms were found and whether they were reassigned
- Which new molecules/atoms were created

## MCP Tools

**Create project (if needed):**
```
manage_container
  operation: "create"
  containerType: "project"
  name: "<repo-name>"
  description: "..."
```

**Create feature:**
```
manage_container
  operation: "create"
  containerType: "feature"
  projectId: <project-uuid>
  name: "Feature Name"
```

**Create task:**
```
manage_container
  operation: "create"
  containerType: "task"
  featureId: <feature-uuid>
  title: "Task Title"
  priority: "HIGH" | "MEDIUM" | "LOW"
```

**Query templates (to get template ID):**
```
query_templates
  operation: "list"
  targetEntityType: "PROJECT" | "FEATURE" | "TASK"
  isEnabled: true
  includeSections: true
```

**Apply template:**
```
apply_template
  templateId: <template-uuid>
  entityType: "PROJECT" | "FEATURE" | "TASK"
  entityId: <entity-uuid>
```

**Query sections (after applying template):**
```
query_sections
  entityType: "PROJECT" | "FEATURE" | "TASK"
  entityId: <entity-uuid>
  includeContent: true
```

**Update section content:**
```
manage_sections
  operation: "updateText"
  sectionId: <section-uuid>
  content: "..."
  version: <current-version>
```

**Set dependency:**
```
manage_dependency
  operation: "create"
  fromTaskId: <blocking-task>
  toTaskId: <blocked-task>
  type: "BLOCKS"
```

**Validate execution order:**
```
get_next_task
  featureId: <feature-uuid>
```
