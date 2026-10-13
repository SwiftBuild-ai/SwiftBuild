# Operator backup and recovery drills

SwiftBuild provides private operator commands for binary-safe database backups, offline integrity verification and isolated restoration drills. This tooling has local boundary-test/build coverage; execution of the new database/container drill remains pending in the [verification record](../status.md). They do not switch a live deployment, delete databases, back up browser drafts, or establish production disaster recovery certification.

Use the PostgreSQL tools supplied by the full-server operations image, or install tools matching the recorded PostgreSQL major version. Set the private administrator `DATABASE_URL`. Backup tooling passes credentials through the subprocess environment rather than command arguments and uses a ten-minute timeout per PostgreSQL tool. Backups contain accounts, sessions and architecture data: keep the backup directory and identity configuration private.

## Create and verify a backup

Choose a new directory under an existing private parent. Existing directories are rejected rather than overwritten. Supply `SWIFTBUILD_RELEASE_IMAGE` with the deployed immutable image digest or release commit; otherwise the manifest explicitly records `unrecorded`.

```sh
pnpm server:operator backup --directory /private/backups/swiftbuild-2026-10-13
pnpm server:operator verify-backup --directory /private/backups/swiftbuild-2026-10-13
```

The same commands work in PowerShell with a Windows directory and installed PostgreSQL tools. No binary output redirection is used. When running inside Compose, mount the backup parent into the operations service so the files survive its removal:

```sh
docker compose --env-file server.env -f compose.yaml -f compose.server.yaml run --rm --volume /private/backups:/backups migrate pnpm server:operator backup --directory /backups/swiftbuild-2026-10-13
```

Ensure the container's non-root `node` user can write the mounted parent. On POSIX, the new backup directory is mode `0700` and artifacts are mode `0600`; configure equivalent Windows ACLs independently.

Each completed directory contains `database.dump` and a bounded `manifest.json` in `swiftbuild-database-backup` version `1.0`. The manifest records snapshot/completion times, dump size and SHA-256, PostgreSQL/tool versions, the operator-supplied release label, exact migration checksums and row inventory. A shared exported PostgreSQL snapshot ties the dump and row inventory together while ordinary writes continue. Backups include the dedicated database's public schema. PostgreSQL roles, private configuration, image artifacts and browser storage require separate preservation.

Integrity verification needs no database connection. It rejects damaged/truncated artifacts, unsupported manifest versions, incompatible migrations, alternate file names and symlink artifacts. Hashes detect damage; they do not authenticate untrusted backups. Restore only operator-controlled archives from a trusted source because PostgreSQL restoration executes SQL from the archive. Partial directories without a completed manifest are not usable backups. Do not reuse or automatically remove failed backup directories; inspect them privately.

## Restore into a new isolated database

Use the same PostgreSQL major version and matching SwiftBuild migration release. The runtime role must already exist with its preserved password and without administrator attributes. `SWIFTBUILD_DB_RUNTIME_PASSWORD` supplies its password for the runtime connection check; this command does not rotate it.

```sh
pnpm server:operator recovery-drill --directory /private/backups/swiftbuild-2026-10-13 --database swiftbuild_restore_drill_test
```

The target must be named `swiftbuild_restore_NAME_test` and must not exist. Restoration never overwrites an existing database or runs new migrations. It uses a single transaction, restores without source ownership/ACLs, checks exact migrations and snapshot row counts, runs `ANALYZE`, then reprovisions the existing runtime role's permissions. Runtime validation checks migration reads, project write permission and the absence of schema-create/migration-write privileges. Failed targets remain isolated for inspection; remove only the specific drill database after closing its connections and verifying its identity.

The command prints structured status and backup identifiers without connection strings, passwords, architecture bodies or session data. A successful drill is structural/database-role evidence. The full deployment smoke additionally validates restored identity, immutable revisions, saved reports, operation retries and numerical replay through the runtime connection.

## Production recovery evidence

Record a tested backup schedule, acceptable data-loss interval, restoration time objective, measured snapshot age and drill duration, storage capacity, off-machine copies, encryption/access controls, operator ownership and cleanup/retention policy. Do not delete durable jobs or audit history to implement retention without a separate reviewed policy. Preserve a private deployment configuration and the actual pinned image/dependency artifacts needed for replay.

Validate restoration in a separate deployment before switching application connections. Check active admission, authorized project access, revision exports, analysis bundle digests and representative numerical replay. Verify revoked/viewer/cross-workspace restrictions and health/readiness after a restart. A production cutover, point-in-time recovery and provider-specific organizational sign-in still require deployment-specific execution and evidence. See [deployment](computation.md) and [roadmap gates](../roadmap.md).
