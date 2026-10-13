# ADR 0011: Snapshot manifests and isolated operator recovery

Status: accepted; database/container acceptance uses required hosted CI checks

## Decision

Database backups and recovery are private TypeScript operator capabilities. They do not belong in the canvas, user-facing HTTP routes or Python computation service. Backup artifacts use an independently versioned `swiftbuild-database-backup` manifest, not the architecture archive or analysis bundle formats.

The operator exports a read-only repeatable-read PostgreSQL snapshot. The database dump, migration inventory and table counts share that snapshot. Dump integrity uses a streaming SHA-256 and explicit size; manifests also record snapshot/completion timestamps, database/tool versions and an operator-supplied release label. An absent label is explicitly `unrecorded`.

Restoration requires a trusted operator archive, matching migrations and PostgreSQL major version, and a new isolated database named `swiftbuild_restore_NAME_test`. It never overwrites or deletes targets or applies later migrations. A single-transaction restore excludes source owners and ACLs. The existing runtime role is provisioned separately and tested for read/write access without schema creation or migration writes. Passwords remain in subprocess environments; structured output omits credentials and architecture bodies.

## Consequences and boundaries

The manifest describes a coherent database snapshot while application writes continue. It does not capture cluster-wide roles, identity secrets, immutable image artifacts or browser drafts. Checksums detect damage and do not authenticate untrusted SQL archives. Failed artifacts/targets remain available for private inspection, rather than automatic destructive cleanup.

The deployment smoke now invokes the actual operator CLI for backup, offline verification and the isolated drill before checking restored identity, immutable operation retries and numerical replay through the runtime role. The new container path must pass before claiming integration verification. Local unit checks and a successful build do not substitute for it. Production retention, recovery objectives, cutover and point-in-time recovery remain separate roadmap gates.
