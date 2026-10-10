# 0001 — Native architecture format

Status: accepted.

Context: architecture meaning must survive canvas changes and remain portable.

Decision: use a versioned JSON document with stable IDs, embedded declarative component definitions, and separate view/layout records. Unknown versions fail without modifying input.

Alternatives: canvas-library state as storage; remote registry-dependent definitions.

Consequences: adapters translate rendering state; layout movement does not alter semantic snapshots. Metadata is retained as JSON-safe values.

Migration considerations: every future incompatible shape gets an explicit schema version, deterministic migration, and old fixture tests. YAML will be an adapter to the same document.
