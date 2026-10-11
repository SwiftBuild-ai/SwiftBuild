# SwiftBuild server core

Server-only transactional storage foundation. `migrate(pool)` applies ordered, checksum-verified, maintainer-owned SQL migrations under an advisory lock. An applied migration cannot be edited or removed; introduce a new migration instead. Failed migrations roll back. Apply migrations explicitly before serving requests, with a migration-role connection; the runtime role should not own schema changes.

`createProjectStore(pool)` creates workspaces and projects, reads current/historical archives, performs revision-checked saves and lists project/revision metadata. Every project operation checks workspace membership inside the transaction: owners/editors can write, viewers can read, and absent membership is hidden as not found. Membership locks serialize permission changes with in-flight saves. A server actor ID must come from a verified session, never a request body. This package does not yet supply authentication or expose HTTP routes.

Saves atomically insert an immutable numbered revision and audit event and update the current pointer. Concurrent stale writers are rejected with status 409. Client-generated operation IDs make committed writes retryable; key reuse with different content or actors is rejected. Export-timestamp-only autosaves create no revision. Server resource IDs stay separate from embedded native identities. Archives include checkpoint bodies and run evidence and use the same native migrations and byte limits as the browser.

Integration tests use a real database supplied by `SWIFTBUILD_TEST_DATABASE_URL`; its database name must end in `_test`. Tests create and remove only a unique generated schema. Without that variable, database tests are explicitly skipped, not simulated or reported as verified. CI supplies an isolated database. Run `pnpm exec vitest run packages/server-core/src/projects.integration.test.ts` with the test connection configured.

This foundation is not a finished server product: authenticated APIs, local/organizational sign-in, invitation/recovery commands, browser promotion, deployment and backup/restore workflows remain the next integrated slices. Mail will be optional; the default operator workflow uses one-time links. Existing browser-local work remains available.

Project and revision metadata lists return at most 100 entries; revision history accepts a before-revision cursor. The HTTP integration must expose a complete project pagination contract before large multi-project workspaces are described as supported. See [storage decision](../../docs/adr/0007-server-project-storage.md).
