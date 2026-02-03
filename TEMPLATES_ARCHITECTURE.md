# Templates Repository - Architecture

## Data Model

```
┌─────────────────────────────────────────┐
│           templates                      │
├─────────────────────────────────────────┤
│ id: TEXT (PK)                           │
│ name: VARCHAR(200) UNIQUE NOT NULL      │
│ description: TEXT NOT NULL              │
│ target_entity_type: VARCHAR(50)         │
│ is_built_in: INTEGER (0/1)             │
│ is_protected: INTEGER (0/1)            │
│ is_enabled: INTEGER (0/1)              │
│ created_by: VARCHAR(200)                │
│ tags: TEXT                              │
│ created_at: TEXT                        │
│ modified_at: TEXT                       │
└─────────────────────────────────────────┘
                │
                │ 1:N
                │
                ▼
┌─────────────────────────────────────────┐
│       template_sections                  │
├─────────────────────────────────────────┤
│ id: TEXT (PK)                           │
│ template_id: TEXT (FK) NOT NULL         │
│ title: VARCHAR(200) NOT NULL            │
│ usage_description: TEXT NOT NULL        │
│ content_sample: TEXT NOT NULL           │
│ content_format: VARCHAR(50)             │
│ ordinal: INTEGER NOT NULL               │
│ is_required: INTEGER (0/1)             │
│ tags: TEXT                              │
└─────────────────────────────────────────┘
                │
                │ applyTemplate()
                │ creates
                ▼
┌─────────────────────────────────────────┐
│            sections                      │
├─────────────────────────────────────────┤
│ id: TEXT (PK)                           │
│ entity_type: VARCHAR(50) NOT NULL       │
│ entity_id: TEXT NOT NULL                │
│ title: VARCHAR(200) NOT NULL            │
│ usage_description: TEXT NOT NULL        │
│ content: TEXT NOT NULL                  │
│ content_format: VARCHAR(50)             │
│ ordinal: INTEGER NOT NULL               │
│ tags: TEXT                              │
│ version: INTEGER                        │
│ created_at: TEXT                        │
│ modified_at: TEXT                       │
└─────────────────────────────────────────┘
```

## Entity Relationships

```
┌──────────┐         ┌──────────┐         ┌──────────┐
│ PROJECT  │         │ FEATURE  │         │   TASK   │
└──────────┘         └──────────┘         └──────────┘
     │                    │                     │
     └────────────────────┴─────────────────────┘
                          │
                     entity_id
                     entity_type
                          │
                          ▼
                  ┌──────────────┐
                  │   sections   │
                  └──────────────┘
                          ▲
                          │
                     applyTemplate()
                          │
                  ┌──────────────┐
                  │   templates  │
                  │      +       │
                  │   sections   │
                  └──────────────┘
```

## Function Flow Diagram

### Template Lifecycle

```
┌─────────────┐
│   CREATE    │ createTemplate()
│  Template   │──────────┐
└─────────────┘          │
                         ▼
                  ┌─────────────┐
                  │   ACTIVE    │
                  │  Template   │
                  └─────────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   UPDATE    │  │   ADD       │  │   ENABLE/   │
│  Template   │  │  Sections   │  │   DISABLE   │
└─────────────┘  └─────────────┘  └─────────────┘
         │               │               │
         └───────────────┼───────────────┘
                         │
                         ▼
                  ┌─────────────┐
                  │   APPLY     │
                  │  Template   │────────┐
                  └─────────────┘        │
                         │               │
                         │               ▼
                         │        ┌─────────────┐
                         │        │   Creates   │
                         │        │  Sections   │
                         │        └─────────────┘
                         │
                         ▼
                  ┌─────────────┐
                  │   DELETE    │ deleteTemplate()
                  │  Template   │────────────────┐
                  │     +       │                │
                  │  Sections   │                │
                  └─────────────┘                │
                         │                       │
                         └───────────────────────┘
```

### applyTemplate() Flow

```
┌─────────────────────┐
│ applyTemplate()     │
│ (templateId,        │
│  entityType,        │
│  entityId)          │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────┐
│ 1. Get Template + Sections  │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ 2. Validate:                │
│    - Template is enabled    │
│    - Entity type matches    │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ 3. START TRANSACTION        │
└──────────┬──────────────────┘
           │
           ▼
     ╔═════════════════════════╗
     ║ For each template       ║
     ║ section:                ║
     ╠═════════════════════════╣
     ║ - Generate new ID       ║
     ║ - Copy metadata         ║
     ║ - Use contentSample     ║
     ║   as initial content    ║
     ║ - INSERT into sections  ║
     ╚═════════════════════════╝
           │
           ▼
┌─────────────────────────────┐
│ 4. COMMIT TRANSACTION       │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ 5. Return created sections  │
└─────────────────────────────┘
```

## Protection Mechanism

```
┌─────────────────────────┐
│   UPDATE or DELETE      │
│   Request               │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   Check is_protected    │
│   flag                  │
└───────────┬─────────────┘
            │
     ┌──────┴──────┐
     │             │
     ▼             ▼
┌─────────┐   ┌─────────┐
│is_pro-  │   │is_pro-  │
│tected=1 │   │tected=0 │
└────┬────┘   └────┬────┘
     │             │
     ▼             ▼
┌─────────┐   ┌─────────┐
│ REJECT  │   │ ALLOW   │
│ Return  │   │ Proceed │
│ Error   │   │ with    │
│ Code    │   │ Opera-  │
│         │   │ tion    │
└─────────┘   └─────────┘
```

## Module Structure

```
src/repos/
  └── templates.ts
       │
       ├── Internal Types
       │    ├── TemplateRow
       │    └── TemplateSectionRow
       │
       ├── Mapping Helpers
       │    ├── mapTemplateRow()
       │    └── mapTemplateSectionRow()
       │
       ├── Template Operations
       │    ├── createTemplate()
       │    ├── getTemplate()
       │    ├── listTemplates()
       │    ├── updateTemplate()
       │    ├── deleteTemplate()
       │    ├── enableTemplate()
       │    └── disableTemplate()
       │
       ├── Section Operations
       │    └── addTemplateSection()
       │
       └── Application
            └── applyTemplate()
```

## Query Patterns

### Dynamic Filtering (listTemplates)

```typescript
let sql = 'SELECT * FROM templates WHERE 1=1';
const params: any[] = [];

// Build WHERE clause dynamically
if (targetEntityType) {
  sql += ' AND target_entity_type = ?';
  params.push(targetEntityType);
}

if (isBuiltIn !== undefined) {
  sql += ' AND is_built_in = ?';
  params.push(isBuiltIn ? 1 : 0);
}

// Execute with accumulated params
queryAll<TemplateRow>(sql, params);
```

### Auto-Ordinal Pattern

```sql
-- Get max ordinal for template
SELECT MAX(ordinal) as max_ordinal
FROM template_sections
WHERE template_id = ?

-- New ordinal = max + 1 (or 0 if no sections)
ordinal = (maxOrdinal?.max_ordinal ?? -1) + 1;
```

### Cascade Delete Pattern

```typescript
transaction(() => {
  // Delete children first
  execute('DELETE FROM template_sections WHERE template_id = ?', [id]);

  // Then delete parent
  execute('DELETE FROM templates WHERE id = ?', [id]);
});
```

## State Machine

### Template States

```
┌──────────┐
│ CREATED  │
│ enabled  │
│protected │
└────┬─────┘
     │
     ├─ enableTemplate() ──────┐
     │                         ▼
     │                   ┌──────────┐
     │                   │ ENABLED  │
     │                   └────┬─────┘
     │                        │
     ├─ disableTemplate() ◄───┘
     │
     ▼
┌──────────┐
│ DISABLED │
└────┬─────┘
     │
     │ Cannot apply
     │ (returns error)
     │
     └─────────────────────────
```

### Protection States

```
┌────────────────┐
│  is_protected  │
│      = 0       │
└───────┬────────┘
        │
        ├─ updateTemplate() ✓
        │
        ├─ deleteTemplate() ✓
        │
        └─ Set protected flag
                │
                ▼
        ┌────────────────┐
        │  is_protected  │
        │      = 1       │
        └───────┬────────┘
                │
                ├─ updateTemplate() ✗
                │
                └─ deleteTemplate() ✗
```

## Transaction Boundaries

All write operations use transactions:

```
┌─────────────────────────────────────┐
│         TRANSACTION                 │
├─────────────────────────────────────┤
│  BEGIN                              │
│                                     │
│  1. Write Operation(s)              │
│     - INSERT                        │
│     - UPDATE                        │
│     - DELETE                        │
│                                     │
│  2. Read back result                │
│     - SELECT to get complete row    │
│                                     │
│  3. Transform & return              │
│     - Map DB row to domain type     │
│                                     │
│  COMMIT (automatic if no error)     │
│  ROLLBACK (automatic on error)      │
└─────────────────────────────────────┘
```

## Error Propagation

```
Database Error
     │
     ▼
try-catch block
     │
     ├─ ValidationError ──────┐
     │                        │
     ├─ NotFoundError ────────┤
     │                        │
     ├─ Other Error ──────────┤
     │                        │
     └────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │   Result<T>      │
                    │   success: false │
                    │   error: string  │
                    │   code?: string  │
                    └──────────────────┘
```

## Index Usage

### Templates Table Indexes

```sql
-- Primary key
PK: id

-- Unique constraint
UNIQUE: name

-- Query optimization indexes
INDEX: target_entity_type  (for filtering)
INDEX: is_built_in         (for filtering)
INDEX: is_enabled          (for filtering)
```

### Template Sections Table Indexes

```sql
-- Primary key
PK: id

-- Foreign key
FK: template_id → templates(id)

-- Query optimization indexes
INDEX: template_id              (for joins)
UNIQUE: (template_id, ordinal)  (ensures unique ordering)
```

## Performance Considerations

1. **Indexes**: All filter columns are indexed
2. **Transactions**: Atomic operations prevent partial updates
3. **Batch Operations**: applyTemplate() creates all sections in one transaction
4. **Lazy Loading**: Sections only loaded when requested (includeSections parameter)
5. **No N+1 Queries**: Single query for all sections when needed

## Extension Points

The architecture supports future enhancements:

1. **Template Versioning**: Add version column to templates table
2. **Section Dependencies**: Add parent_section_id for nested sections
3. **Conditional Sections**: Add conditions column for dynamic sections
4. **Section Variables**: Add variable substitution in contentSample
5. **Template Categories**: Add category_id foreign key
6. **Audit Trail**: Add created_by/modified_by to sections
7. **Soft Delete**: Add deleted_at column instead of hard delete
8. **Template Sharing**: Add owner_id and visibility columns
