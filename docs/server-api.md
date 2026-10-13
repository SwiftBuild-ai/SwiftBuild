# SwiftBuild server API

## Engineering computation jobs

All job routes live under `/api/v1/projects/PROJECT_ID/jobs`. They use the existing session, same-origin mutation, no-store and request-ID policies. Owners/editors submit/cancel/import; viewers read/export. Absent or cross-workspace membership is hidden as not found. Backend actors never come from payloads.

- `POST /jobs`: strong `If-Match` current revision, `{operationId, input, imported?: false}`. Normal input is `{definition, seed?: 42, samples?: 10000, deadlineMs?: 120000}`. Returns the durable job with status 202. Repeated operation IDs return the same job; changed input is rejected. Stale revisions return 412.
- `GET /jobs?before=JOB_ID`: newest-first metadata pages of at most 100 entries and `nextCursor`; full inputs/reports are fetched only through detail/export. `GET /jobs/JOB_ID` returns authorized detail.
- `POST /jobs/JOB_ID/cancel`: accepts cancellation. Queued work cancels immediately; running work enters cancelling and cannot publish a later successful result.
- `GET /jobs/JOB_ID/export`: versioned `swiftbuild-analysis` bundle with original execution inputs and report. Successful capacity bundles include TypeScript engine samples and their fingerprints.
- `POST /jobs` with `{operationId, imported: true, input: BUNDLE}`: validates and stores a historical bundle for the same project and an existing referenced revision. `If-Match` still identifies the current project revision. Imports never enter the execution queue.

Schemas live in `@swiftbuild/architecture-schema/analysis` and `@swiftbuild/computation-contracts`; committed JSON Schema generates Python types. Contract, bundle and numerical model versions are independent. Input/results are bounded to 8 MiB. Queue admission is limited to ten queued jobs per workspace and one active job per workspace.

Private Python `/v1/executions` accepts a versioned input, canonical SHA-256 digest and attempt UUID. `/v1/executions/ATTEMPT_ID` accepts cancellation through DELETE. These endpoints require a private deployment bearer token and have no public route or database credentials. The dispatcher validates returned schemas and digests before transactional publication. See [model behavior](engineering/analysis.md) and [deployment](self-hosting/computation.md).

Server mode is optional and requires private database/identity configuration and explicitly applied migrations. Browser-local work remains available. Authentication endpoints are exposed at `/api/auth`; local registration requires a valid invitation. Operator-issued links need no mail server.

The `/login`, `/invite`, and `/reset-password` screens support password accounts, configured organizational sign-in, one-time invitation acceptance, and operator-issued password recovery. `/account` shows the admitted identity, links to projects and offers sign-out. Existing organizational accounts should sign in and then reopen an invitation to accept an additional workspace membership. Password recovery revokes existing sessions. Account pages request no indexing and no referrer transmission; credential fields remain disabled until client handlers are ready and native forms use POST.

`/projects` lists authorized memberships/projects with pagination and explicit create/import/copy actions. `/projects/PROJECT_ID` mounts the server editor, labels confirmed server saves, preserves local recovery before HTTP mutation, and exports immutable revision snapshots. A retained uncertain save is retried with its original operation before newer work is sent; a conflict or access change halts network saves. Recovery is exported, saved as a separate authorized project or explicitly discarded. Viewer edits remain local previews. Local browser drafts remain independent. See [storage and recovery boundaries](self-hosting/README.md).

| Method     | Path                                    | Behavior                                                                |
| ---------- | --------------------------------------- | ----------------------------------------------------------------------- |
| GET        | `/api/health`                           | Web process liveness, independent of database state                     |
| GET        | `/api/v1/ready`                         | Database connectivity and exact applied migration checksums             |
| GET        | `/api/v1/session`                       | Current admitted user and whether organizational sign-in is configured  |
| GET / POST | `/api/v1/workspaces`                    | List memberships or create an owned workspace                           |
| POST       | `/api/v1/invitations/accept`            | Accept a matching invitation while authenticated                        |
| GET / POST | `/api/v1/projects`                      | List authorized workspace projects or create/import a validated archive |
| GET / PUT  | `/api/v1/projects/PROJECT_ID`           | Read a snapshot or save a new revision                                  |
| GET        | `/api/v1/projects/PROJECT_ID/revisions` | List immutable revision metadata                                        |
| GET        | `/api/v1/projects/PROJECT_ID/export`    | Export a complete current archive                                       |

Project creation accepts `{ workspaceId, operationId, archive }`; saves accept `{ operationId, archive }`. Operation IDs are client-generated UUIDs retained across retries. Project resource IDs remain separate from native IDs. The archive uses format/version 1.0 and native migration rules; no file format changes.

Reads and saves return `{ id, workspaceId, revision, archive }`; project reads also include the current role. The `ETag` is the quoted revision. Saves require a single strong `If-Match` revision tag; missing tags return 428, malformed tags 400 and stale revisions 412. Retry-key payload collisions return 409. Failed writes leave the previous revision intact. Saved snapshots and audit events commit atomically.

Project listing requires `workspaceId`. Pages contain at most 100 `items` with `nextCursor`; pass its `id` and `updatedAt` as `afterId` and `beforeUpdatedAt`. Workspace pages use an `after` UUID; revision pages use a `before` revision number. A full final page can supply a cursor whose next page is empty. Preserve timestamp strings exactly rather than truncating their fractional precision.

HTTP mutations require the configured origin and JSON content type. Actual streamed bytes are bounded before parsing: authentication and small metadata requests use 16 KiB; project request envelopes use the 50 MiB archive limit plus 64 KiB overhead. Archive serialization is separately checked against 50 MiB. Invalid archives and fields are rejected before replacement. Missing membership is hidden as 404; viewers receive 403 on writes. Active admission and membership are locked during transactional project operations, so disabling an account or revoking membership cannot silently race an authorized save.

Responses are not cached. Application errors use `{ error: { code, message }, requestId }` and `X-Request-ID`; storage failures log structured event/status/request-ID fields without request bodies, credentials or archive contents. Authentication-library responses retain their own endpoint shape. Liveness does not establish database readiness, completed deployment verification or security certification.

### Durable creation recovery

The web host persists one unresolved creation intent per signed-in user and workspace in IndexedDB before submitting new projects, imported archives, saved drafts or recovery copies. Reload offers explicit retry and export; retry retains the original archive and operation ID. Storage failure prevents submission. A confirmed response clears only the matching operation. Browser site-data deletion removes recovery, so export before clearing it.

Creation requests may include `expectedActorId` to reject an account switch in an older tab. This field is a precondition; the verified session remains the actor and permissions are still enforced by the storage transaction.
