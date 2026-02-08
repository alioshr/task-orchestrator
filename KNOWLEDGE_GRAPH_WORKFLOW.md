# Knowledge Graph Workflow Examples

Concrete walkthrough of how an agent interacts with the knowledge graph through the three orchestrator skill phases: Discovery, Planning, and Execution.

## Discovery Phase

Agent opens a session. Discovery skill fires.

### Step 1 — Find the project (existing flow)

```
query_container
  operation: "search"
  containerType: "project"
  query: "my-monorepo"
```

Returns project `proj-123`.

### Step 2 — Get next task (existing flow)

```
get_next_task
  projectId: "proj-123"
```

Returns task `task-456`: "Add retry logic to payment webhook".

### Step 3 — Fetch task with sections

```
query_container
  operation: "get"
  containerType: "task"
  id: "task-456"
  includeSections: true
```

Agent reads Context Files section:
```
src/payments/webhook-handler.ts
src/payments/stripe-gateway.ts
src/shared/retry-utils.ts
```

### Step 4 — Query the knowledge graph

```
query_graph
  operation: "context"
  projectId: "proj-123"
  paths: "src/payments/webhook-handler.ts,src/payments/stripe-gateway.ts,src/shared/retry-utils.ts"
```

Returns:

```json
{
  "molecules": [
    {
      "name": "Payment Domain",
      "knowledge": "Communicates with Stripe via gateway, all webhooks must be idempotent, uses event sourcing",
      "atoms": [
        {
          "name": "Webhook Handlers",
          "knowledge": "8 handlers, all extend BaseWebhookHandler, locales from registry, 30s timeout from Stripe",
          "matchedPaths": ["src/payments/webhook-handler.ts", "src/payments/stripe-gateway.ts"],
          "relatedAtoms": [
            { "name": "Stripe Integration", "reason": "webhooks call gateway for payment processing, gateway retries internally so webhook must not double-retry" }
          ]
        }
      ]
    }
  ],
  "orphanAtoms": [
    {
      "name": "Retry Utilities",
      "knowledge": "Generic exponential backoff, used across 4 subsystems",
      "matchedPaths": ["src/shared/retry-utils.ts"]
    }
  ],
  "unmatchedPaths": []
}
```

### Step 5 — Present to user

```
Project: my-monorepo (IN_PROGRESS)
Next task: Add retry logic to payment webhook

Graph context:
  Payment Domain: webhooks must be idempotent, event sourcing
    Webhook Handlers: all extend BaseWebhookHandler, 30s timeout
      matched: webhook-handler.ts, stripe-gateway.ts
      related: Stripe Integration — gateway retries internally,
        webhook must not double-retry
  Orphan: Retry Utilities — generic backoff, used across 4 subsystems
    matched: retry-utils.ts

Shall I start on this?
```

The agent knows not to add retry logic that conflicts with the gateway's internal retry — without reading a single file.

---

## Planning Phase

User says: "We need to add a notification system that sends emails when payments fail."

### Step 1 — Search for existing graph knowledge

```
query_graph
  operation: "search"
  entityType: "atom"
  projectId: "proj-123"
  query: "payment"
```

Returns atoms in the payment area. Agent sees Payment Domain molecule exists.

```
query_graph
  operation: "search"
  entityType: "atom"
  projectId: "proj-123"
  query: "notification email"
```

Returns nothing — no notification atoms exist. But finds an orphan atom "Email Client" with path `["src/shared/email-client.ts"]`.

### Step 2 — Create feature and tasks (existing flow)

```
manage_container
  operation: "create"
  containerType: "feature"
  projectId: "proj-123"
  name: "Payment Failure Notifications"
```

Create 3 tasks, apply templates, fill sections. Use graph knowledge:
- Implementation Plan references "webhook-handler.ts already has PaymentEvent type" (from atom knowledge)
- Implementation Plan says "do NOT add retry on top of gateway's internal retry" (from related atom reason)
- Context Files includes `src/shared/email-client.ts` (from orphan atom)

### Step 3 — Create graph structures for the new area

```
manage_graph
  operation: "create"
  entityType: "molecule"
  projectId: "proj-123"
  name: "Notification System"
  knowledge: "Handles email and push notifications triggered by domain events. Consumes events from Payment Domain. Uses shared email-client."
  createdByTaskId: "task-789"
```

Returns `mol-001`.

```
manage_graph
  operation: "create"
  entityType: "atom"
  projectId: "proj-123"
  moleculeId: "mol-001"
  name: "Payment Failure Alerts"
  paths: '["src/notifications/payment/**"]'
  knowledge: "Listens for failed PaymentEvents, sends notification emails. Must not duplicate if webhook retries."
  relatedAtoms: '[{ "atomId": "atom-webhook-handlers", "reason": "subscribes to PaymentFailedEvent from webhook handler" }]'
  createdByTaskId: "task-789"
```

Reassign orphan email client atom to the notification molecule:

```
manage_graph
  operation: "update"
  entityType: "atom"
  id: "atom-email-client"
  moleculeId: "mol-001"
  lastTaskId: "task-789"
  version: 1
```

### Step 4 — Present plan with graph summary

```
Plan: Payment Failure Notifications

3 tasks created under feature.
Graph updates:
  Created molecule: Notification System
  Created atom: Payment Failure Alerts (src/notifications/payment/**)
  Reassigned orphan: Email Client -> Notification System
Gaps: Tasks will create src/notifications/payment/alert-handler.ts
  and src/notifications/payment/templates/ — covered by new atom pattern.
```

---

## Execution Phase

Agent picks up task `task-789`: "Create payment failure notification handler."

### Step 1 — Fetch task with graph context (single call)

```
query_container
  operation: "get"
  containerType: "task"
  id: "task-789"
  includeSections: true
  includeGraphContext: true
```

Returns task, sections, AND graph context. Passed to sub-agent.

### Step 2 — Sub-agent does the work

Writes code. Creates:
- `src/notifications/payment/alert-handler.ts`
- `src/notifications/payment/templates/payment-failed.html`

Modifies:
- `src/payments/webhook-handler.ts` (added event emission)

### Step 3 — Verification passes

### Step 4 — Update the graph

**Update the atom that was affected by the modification to webhook-handler.ts:**

```
query_graph
  operation: "context"
  projectId: "proj-123"
  paths: "src/payments/webhook-handler.ts"
```

Finds the Webhook Handlers atom. Update its knowledge:

```
manage_graph
  operation: "update"
  entityType: "atom"
  id: "atom-webhook-handlers"
  knowledgeMode: "append"
  knowledge: "Now emits PaymentFailedEvent consumed by notification system's payment-alert handler."
  lastTaskId: "task-789"
  version: 3
```

**Update the new atom's knowledge with implementation details:**

```
manage_graph
  operation: "update"
  entityType: "atom"
  id: "atom-payment-alerts"
  knowledgeMode: "append"
  knowledge: "alert-handler.ts deduplicates by payment ID to handle webhook retries. Template uses Handlebars, locales resolved from registry at render time."
  lastTaskId: "task-789"
  version: 1
```

**Update related atoms to reflect the new connection:**

```
manage_graph
  operation: "update"
  entityType: "atom"
  id: "atom-webhook-handlers"
  relatedAtoms: '[{ "atomId": "atom-payment-alerts", "reason": "emits PaymentFailedEvent consumed by alert handler" }]'
  lastTaskId: "task-789"
  version: 4
```

**Log the significant change:**

```
manage_changelog
  operation: "append"
  parentType: "atom"
  parentId: "atom-webhook-handlers"
  taskId: "task-789"
  summary: "Added PaymentFailedEvent emission for notification system integration"
```

```
manage_changelog
  operation: "append"
  parentType: "atom"
  parentId: "atom-payment-alerts"
  taskId: "task-789"
  summary: "Initial implementation: alert-handler with dedup by payment ID, Handlebars email template with registry locales"
```

### Step 5 — Advance status

```
advance
  containerType: "task"
  id: "task-789"
  version: 2
```

---

## Tool Usage Summary

| Phase | Graph Reads | Graph Writes |
|-------|-------------|--------------|
| Discovery | `query_graph context` | None |
| Planning | `query_graph search` (atoms, molecules, orphans) | `manage_graph create` (molecules, atoms), `manage_graph update` (reassign orphans) |
| Execution | `query_container` with `includeGraphContext` | `manage_graph update` (atom knowledge, paths, related atoms), `manage_graph create` (new atoms), `manage_changelog append` |

Discovery never writes. Planning reads and creates high-level structures. Execution updates knowledge from what it actually did.

The total graph overhead per task execution: 1 context read (already bundled with task fetch), 2-4 atom updates, 1-2 changelog appends. Roughly 3-6 extra tool calls — manageable and concentrated at the end of the task, not scattered throughout.
