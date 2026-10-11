# SwiftBuild server API

Server mode is optional and requires private database/identity configuration and explicitly applied migrations. Browser-local work remains available. Authentication endpoints are exposed at `/api/auth`; local registration requires a valid invitation. Operator-issued links need no mail server. The web sign-in and project screens are the next integration slice.

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
