# 0007 — Transactional server project storage

Status: accepted.

Context: durable server projects must preserve existing native/archive contracts, reject stale writes and enforce permissions independently of editor controls.

Decision: isolate server-only services in `server-core`, depending on the shared `project-format` contract rather than canvas. Use pooled relational database connections and ordered, checksum-verified SQL migrations. Apply migrations explicitly under a transaction-scoped advisory lock; never silently edit applied history.

Store workspaces, memberships, project resource metadata, immutable archive revisions and durable audit events. Server resource IDs remain independent from portable native IDs. Check membership in each transaction; membership locks serialize revocation with saves. Owners/editors can write; viewers can read; missing membership is hidden as not found. Authentication is a separate required boundary: service actor IDs must come from verified sessions before HTTP exposure.

A save locks the project, checks its expected revision, and atomically inserts its archive revision and audit event before updating the current pointer. Operation IDs identify retried requests; different actors or payloads cannot reuse them. Export-timestamp-only changes do not create revisions. Checkpoint bodies and engineering evidence remain in validated versioned archives; no existing file format is redefined.

Consequences: historical snapshots initially duplicate archive data, favoring straightforward recovery and compatibility over premature storage optimization. Any later compaction needs explicit retention policy and recovery tests. Integration tests exercise a real isolated database, including stale writers, permissions, reconnection, retry keys, audit interruption and migration rollback. This decision does not establish an authenticated server UI, completed deployment or backup certification.
