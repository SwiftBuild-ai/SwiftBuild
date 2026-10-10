# Architecture

The native JSON document is canonical. Nodes contain architecture semantics; views contain layout. Embedded versioned declarative definitions make documents portable without a registry dependency.

Dependency direction: web → canvas → graph-engine → architecture-model → architecture-schema. components-core depends on architecture-schema. ui depends on design-tokens. No core package depends on a host or user account.

The editor owns a per-instance store with validated immutable documents, bounded undo history, selection and transient interaction state. Browser persistence is an adapter. Graph integrity validation is distinct from future engineering policy validation.

Later milestones add requirements/decisions workflows, deterministic rules and capacity, extension SDK, YAML/CLI/diffs, server projects, and collaboration. AI remains deferred until structured validation is mature.
