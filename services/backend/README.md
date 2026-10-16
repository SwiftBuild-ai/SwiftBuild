# SwiftBuild Python backend

Python 3.12 owns public HTTP, identity, relational storage, migrations, durable job scheduling, server capacity calculations and private operator commands. Next.js renders pages and forwards same-origin HTTP requests. Browser-local editing and simulations remain independent. See [ownership decision](../../docs/adr/0012-python-backend.md) and [HTTP contracts](../../docs/server-api.md).

## Install and run

Create a virtual environment in this directory and install the pinned lock. PowerShell:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.lock
```

POSIX:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.lock
```

Use `requirements.lock` for runtime-only installation. From this directory the native commands are:

```sh
python -m swiftbuild_backend.cli migrate
python -m swiftbuild_backend.cli bootstrap --email owner@example.test
python -m swiftbuild_backend
python -m swiftbuild_backend.worker
```

Run API and worker in separate processes using the environment's Python. Installing this package also exposes `swiftbuild-operator` and `swiftbuild-worker`. Neither needs Node. Root convenience wrappers are `pnpm backend:dev`, `pnpm backend:worker` (also `pnpm computation:worker`), and `pnpm server:operator COMMAND`.

The API binds loopback port 8001; `SWIFTBUILD_BACKEND_PORT` changes the port and `SWIFTBUILD_BACKEND_HOST` changes the bind address. Containers bind `0.0.0.0` on their private network. Configure only `SWIFTBUILD_BACKEND_URL=http://127.0.0.1:8001` in the web process. Configure `DATABASE_URL`, `SWIFTBUILD_URL` (the public web origin) and a stable private `SWIFTBUILD_AUTH_SECRET` of at least 32 characters in the Python processes. Explicit loopback development permits `SWIFTBUILD_ALLOW_LOCAL_HTTP=1`. Beyond loopback use HTTPS. The API does not apply migrations on startup. Use a separate migration role and a restricted runtime connection.

Optional organizational sign-in requires all three `SWIFTBUILD_OIDC_*` settings in [.env.example](../../.env.example). Existing password hashes, accounts, invitations and recovery records remain compatible. Users sign in again when switching from the legacy session cookie. Explicit authenticated linking is required for existing organizational identities.

Engineering job admission requires `SWIFTBUILD_COMPUTATION_ENABLED=1`, a private `SWIFTBUILD_COMPUTATION_URL` and `SWIFTBUILD_COMPUTATION_TOKEN`. Start the independent [numerical supervisor](../../docs/self-hosting/computation.md). The dispatcher owns database access; child numerical processes receive an allowlisted environment without database, identity or provider credentials. Durable jobs use PostgreSQL leases and attempt fencing; request background tasks never schedule them.

`GET /api/health` is API liveness; `GET /api/v1/ready` checks migration compatibility and enabled worker availability. The web host's `/api/health` remains its own liveness check. API logs contain request IDs and error codes without bodies, cookies, tokens or connection strings. Access URL logging is disabled because recovery callback paths contain secrets.

## Contracts and verification

Run from the repository root:

```sh
pnpm backend:check
pnpm backend:lint
pnpm backend:test
```

`pnpm backend:generate` updates synthetic TypeScript reference fixtures, exact migration payloads, JSON Schemas, Python structural models, FastAPI OpenAPI and frontend API types. Review generated changes together. Check mode never rewrites files. Generated types supplement semantic validation in `domain.py` and `analysis.py`.

Reference fixtures record revision `e0897901bdf865b356f0a5406c147ba571436178`. Capacity comparisons preserve event ordering, seed streams, coverage and uncertainty; numerical comparisons use declared relative/absolute tolerance of 1e-10. Python reports identify implementation `1.2.0-python.1`, retaining model version 1.0. Project retry serialization preserves JavaScript behavior separately from canonical numerical digests.

Tests require `SWIFTBUILD_TEST_DATABASE_URL` naming an isolated `_test` database. They create unique schemas; recovery tests create only new `swiftbuild_restore_NAME_test` databases. Without the connection, database tests skip explicitly. Install native PostgreSQL client tools matching the server major version to run backup/restore tests. Run the browser-local and dedicated server suites in [DEVELOPMENT.md](../../DEVELOPMENT.md); the latter launches this API and Python worker.

Operators provide `migrate`, `bootstrap`, `bootstrap-rotate`, `invite`, `recover`, `backup`, `verify-backup`, and `recovery-drill`. Arguments match the existing wrappers. See [recovery commands](../../docs/self-hosting/recovery.md). One-time links and backups require private delivery/storage.

The legacy TypeScript server package remains temporarily for compatibility fixtures. The current web application has no runtime dependency on it. The [full-server Compose configuration](../../docs/self-hosting/computation.md) runs separate Python API, worker, numerical supervisor and operator services. `python -m swiftbuild_backend.worker_health` checks dispatcher heartbeat freshness. The disposable deployment smoke uses Python-only operations and checks backup/restore, numerical replay and recreation against the same volume. Production routing, rolling-cutover certification and UX implementation remain deferred.
