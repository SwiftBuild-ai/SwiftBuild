# Native files and project archives

Native architecture JSON uses schema version 1.1. It contains stable semantic IDs, embedded versioned declarative component definitions, view-only layout, requirements, decisions, annotations, scenarios, profiles, flow policies and assessments. Component schema/semantic versions are independent from the document version.

`migrateDocument` explicitly migrates 1.0 into 1.1 without mutating the input. Parsing/import paths invoke that migration for old native files; unsupported versions are rejected. JSON-safe metadata and legacy IDs are preserved. Structural validation runs before replacement.

Optional versioned catalog identity extends embedded definitions with separate taxonomy, technology/provider identity, search aliases, local icon references, contextual configuration, declarative validation and capacity resource bindings. Catalog-free legacy definitions continue to load. Technology conversion is an explicit undoable operation, never an import side effect. Local component pack format 1.0 is separate from native document and component versions.

Architecture imports are limited to 5 MB. Project archives have `format: swiftbuild-project`, archive version 1.0, a current native document, immutable checkpoint documents, run summaries and an export timestamp. Archives are limited to 50 MB. Every document and report is validated before atomic replacement. Imported runs are historical until rerun.

Checkpoint bodies are outside the current document, avoiding recursive snapshots. Restoring creates a recovery checkpoint and one undoable edit. Comparison reports additions, removals and changes by stable IDs, independently of layout and collection insertion order. Keep a project archive to preserve checkpoints and engineering evidence; architecture-only JSON intentionally contains no checkpoint bodies.

Browser storage is origin-specific transactional IndexedDB. Legacy localStorage drafts are retained after migration. Invalid data and transaction failures do not trigger silent replacement. Optimistic storage revisions prevent stale tabs from overwriting newer edits. Export current in-memory work before reloading after a conflict or clearing browser data.
