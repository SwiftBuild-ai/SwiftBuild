# 0012: Python owns server authority

Status: accepted. Supersedes the TypeScript server ownership portions of [0007](0007-server-project-storage.md), [0008](0008-invite-only-identity.md) and [0009](0009-engineering-computation-service.md). Their persistence, admission, isolation and mathematical contracts remain in force.

## Decision

`services/backend/swiftbuild_backend` owns authentication, authorization, public FastAPI routes, explicit SQL repositories, immutable revisions, audit records, durable jobs, migrations, server capacity calculations and operator commands. Python 3.12, FastAPI, strict Pydantic v2, Psycopg asynchronous pools and Authlib implement this boundary. There is no ORM conversion. Pool resources follow application lifespan; workers and operators have independent native entry points.

Next.js owns rendering and transparent same-origin HTTP adapters. Only the backend origin is needed by the web process; database and identity credentials belong to Python. Verified sessions derive actors. Transactional membership/admission locks, strong revision tags, retained operation IDs and stale-write rejection remain mandatory. Browser recovery records and offline operation retain their existing formats and behavior.

TypeScript domain packages remain the browser implementation and cross-language reference. Committed synthetic fixtures record the reviewed baseline revision. JSON Schema generation covers native documents, archives and analysis; Python models provide structural contracts while explicit semantic ports preserve defaults, migration and graph/configuration rules. OpenAPI generates frontend API types. Drift checks gate changes.

The four original migration IDs, SQL bytes and checksums remain unchanged and use the existing ledger and advisory lock. Existing database contents, account/provider IDs, scrypt hashes, invitation/recovery tokens and operation receipts survive conversion. Active sessions may require sign-in again. New OIDC uses Authlib with state, PKCE, nonce and signed issuer/audience checks; provider-token encryption remains compatible.

Server capacity analysis, discrete-event simulations and sensitivity sweeps run Python implementations preserving seeded streams and event ordering. Reports distinguish the Python implementation version from unchanged mathematical model versions. PostgreSQL continues to own durable scheduling, leases, attempt fencing and publication. Bounded child processes run numerical code with an allowlisted environment; the private computation supervisor remains credential-isolated.

## Consequences and limits

`packages/server-core` remains temporarily at the user's direction as legacy reference/compatibility code. It is absent from the web application's runtime dependency graph. Compatibility fixture generation and legacy comparison tests may use it. Removal follows deployment updates and parity review; no new product behavior belongs there.

Docker files and deployment infrastructure remain unchanged. Existing full-server container recipes are not certified for the new topology. Native tests use isolated PostgreSQL and matching local recovery tools without Docker. Production routing, zero-downtime cutover and hosted operational certification remain separate work.

UI implementation is deferred. The scoped audit found small labels on a fitted canvas and an Engineering analysis prerequisite screen without an actionable next step. Captures remain in ignored `.agent-work/fastapi-audit`; these observations do not establish broader accessibility findings.

See [backend setup and verification](../../services/backend/README.md).

### Required deployment gate follow-up, October 16, 2026

The required merge smoke exposed that the retained container image lacked Python and its web/dispatcher wiring still targeted TypeScript authority. The follow-up moves container migration/operators, dispatcher, health probes and recovery/restart smoke to Python, and connects the web shell to a separate private FastAPI service. Browser-local Compose remains independent. This supersedes the Docker deferral above for compatibility with the existing merge gate; production routing and rolling-cutover certification remain deferred.
