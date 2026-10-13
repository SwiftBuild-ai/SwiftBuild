# SwiftBuild server core

Server-only transactional storage foundation. `migrate(pool)` applies ordered, checksum-verified, maintainer-owned SQL migrations under an advisory lock. An applied migration cannot be edited or removed; introduce a new migration instead. Failed migrations roll back. Apply migrations explicitly before serving requests, with a migration-role connection; the runtime role should not own schema changes.

`createProjectStore(pool)` creates workspaces and projects, reads current/historical archives, performs revision-checked saves and lists project/revision metadata. Every project operation checks workspace membership inside the transaction: owners/editors can write, viewers can read, and absent membership is hidden as not found. Membership locks serialize permission changes with in-flight saves. A server actor ID must come from a verified session, never a request body. This package supplies invite-only identity and authenticated HTTP services. The web host exposes those services; the server project screens remain a subsequent integration slice.

Saves atomically insert an immutable numbered revision and audit event and update the current pointer. Concurrent stale writers are rejected with status 409. Client-generated operation IDs make committed writes retryable; key reuse with different content or actors is rejected. Export-timestamp-only autosaves create no revision. Server resource IDs stay separate from embedded native identities. Archives include checkpoint bodies and run evidence and use the same native migrations and byte limits as the browser.

Integration tests use a real database supplied by `SWIFTBUILD_TEST_DATABASE_URL`; its database name must end in `_test`. Tests create and remove only a unique generated schema. Without that variable, database tests are explicitly skipped, not simulated or reported as verified. CI supplies an isolated database. Run `pnpm exec vitest run packages/server-core/src/server.integration.test.ts` with the test connection configured.

This foundation is not a finished operational server product. The web host implements account/project screens, revision-checked editing, history export, explicit complete saved-draft promotion and local recovery. Optional full-server deployment, runtime-role provisioning and a backup/restore smoke workflow are described in the [computation deployment guide](../../docs/self-hosting/computation.md). Project-creation retry recovery across reload, revision restoration and bootstrap rotation remain unfinished. Mail will be optional; the default operator workflow uses one-time links. Existing browser-local work remains available.

Project, workspace and revision metadata lists return at most 100 entries per page. The HTTP API exposes cursors for complete traversal and preserves timestamp precision; see [pagination contracts](../../docs/server-api.md) and the [storage decision](../../docs/adr/0007-server-project-storage.md).

## Invite-only identity and operator commands

`createIdentity(pool, config)` supports local passwords and optional configured organizational OIDC. It requires a strong deployment secret and HTTPS, with an explicit loopback-only HTTP exception for development. Database sessions use HttpOnly, same-site cookies and recheck admission on each server request. OAuth identity requires signature, issuer, audience and nonce verification, PKCE and a verified invited email. Automatic same-email account linking is disabled; existing accounts must explicitly link while authenticated.

Authentication HTTP mutations require the configured origin and enforce a 16 KiB body limit. Login, registration and password reset have database-backed rate limits. Disabled accounts cannot regain access through invitations. Invitation tokens are hashed in storage, expire after 24 hours and are consumed with membership and audit updates. Membership data, role and workspace are selected from the stored invitation, never from a signup payload.

Set `DATABASE_URL`, `SWIFTBUILD_URL` and `SWIFTBUILD_AUTH_SECRET` privately. Configure all three `SWIFTBUILD_OIDC_*` settings to enable organizational sign-in. The browser-local application remains usable without these settings.

```sh
pnpm server:operator migrate
pnpm server:operator bootstrap --email owner@example.test
pnpm server:operator invite --email member@example.test --workspace WORKSPACE_ID --role editor
pnpm server:operator recover --email owner@example.test
```

The first administrator can be bootstrapped only through local operator access; there is no public first-user registration endpoint. Commands print one-time invitation/recovery links for private delivery and require no mail server. Do not copy these links into public issues or logs. Recovery uses validated, expiring tokens and revokes prior sessions. Web account screens consume these links and lead to authorized project editing.

Tests exercise real local account creation, sessions, role admission and password recovery, plus an actual local OIDC protocol fixture with signed tokens and PKCE. A fixture is not verification of a particular deployed organizational provider. Independent production security review remains uncompleted.

Database suites share one sequential runner so schema introspection cannot race another fixture cleanup. Transactional concurrency tests still issue competing requests concurrently. Core unit files retain their parallel execution.

The authenticated HTTP boundary requires same-origin mutations, validates bounded UTF-8 JSON, derives actor identity only from the session, checks active admission together with membership during storage transactions, and returns no-store responses with request IDs. Metadata cursors retain full timestamp precision. See [server API](../../docs/server-api.md).

## Engineering jobs

`createJobStore(pool)` owns authorized revision-linked submissions, idempotency, queue admission, attempt leases, fencing, cancellation and historical bundle storage. `pnpm computation:worker` runs the separate TypeScript dispatcher. Reliability computation runs in a private FastAPI supervisor; capacity sweeps call the existing TypeScript engine in a bounded child process. Python has no database credentials or architecture model ownership. See [contracts](../../docs/server-api.md), [models](../../docs/engineering/analysis.md) and [ADR 0009](../../docs/adr/0009-engineering-computation-service.md).

Restoration is an authenticated, permission-checked operation that always appends an immutable revision with source/base metadata. Exact retries reuse the original operation receipt. Bootstrap invitation rotation is private operator tooling and stops permanently after admission. Both are covered by isolated database tests; browser creation and restore recovery belong to the web host. See [server API](../../docs/server-api.md) and [recovery ADR](../../docs/adr/0010-server-recovery-operations.md).
