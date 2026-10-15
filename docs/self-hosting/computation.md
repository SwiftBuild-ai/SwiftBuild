# Server deployment and engineering workers

The current web host uses the [Python backend](../../services/backend/README.md). Docker/deployment updates are deferred; container commands in this guide describe the retained legacy setup and are not qualified for the new topology. For native development, run the backend API and Python worker with database/identity settings, and run the private numerical supervisor without those credentials. `pnpm computation:worker` now starts the Python dispatcher. The TypeScript domain engines remain available for browser-local editing and simulations.

Default `docker compose up --build` still runs browser-local mode. For server projects and engineering computations, copy `server.env.example` to ignored `server.env`, generate separate private hexadecimal passwords/tokens, and keep the identity secret stable. Hexadecimal passwords avoid connection-URL escaping ambiguity. Never use the example values for a deployment.

```sh
docker compose --env-file server.env -f compose.yaml -f compose.server.yaml up --build --wait --wait-timeout 240
```

The one-shot migration service applies checksum-verified migrations with the administrator connection and provisions a separate runtime role. The web host and dispatcher use this runtime role, which does not own tables or schema changes. PostgreSQL data lives in a named volume. The Python service has no published port, database connection or identity-provider configuration.

## Stop, restart and readiness

Use the same private environment file and Compose project name for every start. Stop with `docker compose --env-file server.env -f compose.yaml -f compose.server.yaml down`; this preserves the named database volume. Start again with the command above. Keep database passwords and the identity secret stable. Never add `--volumes` or `-v` when stopping a deployment whose data must survive.

On startup, the database must become healthy before the one-shot migration/provisioning service runs. Web and dispatcher start only after it succeeds; web readiness also waits for the dispatcher heartbeat and compatible private computation service. Schema changes remain outside web startup. On a failed `--wait`, inspect `docker compose --env-file server.env -f compose.yaml -f compose.server.yaml ps -a` and the relevant service logs privately. A database connection failure, failed checksum/migration, missing secret or incompatible/unhealthy computation service must be resolved before treating the host as ready. Preserve the volume and applied migration history; do not bypass checks or rewrite checksums.

The disposable `tooling/scripts/server-smoke.sh` workflow uses an isolated `_test` database. After authenticated editing and backup/restore checks, it removes and recreates the services without removing their volume, signs in as the original synthetic user, verifies membership and the original project and historical exports, then saves and rereads a new revision. Only its final cleanup removes the disposable smoke volume.

Bootstrap through the operator service, forwarding identity configuration from the private environment file:

```sh
docker compose --env-file server.env -f compose.yaml -f compose.server.yaml run --rm migrate pnpm server:operator bootstrap --email owner@example.test
```

The printed one-time link is private. No mail server is required. Configure HTTPS and set `SWIFTBUILD_ALLOW_LOCAL_HTTP=0` outside loopback development. Organizational sign-in remains optional using the existing configuration.

## Local development

Use Node 24 and the repository's pinned pnpm. Python requires 3.12. Install the pinned developer environment using `tooling/scripts/computation-dev.ps1 -Setup` on PowerShell or `sh tooling/scripts/computation-dev.sh setup` on POSIX. Set a private `SWIFTBUILD_COMPUTATION_TOKEN` of at least 32 characters in the computation and dispatcher shells. Set `DATABASE_URL` only in TypeScript shells and `SWIFTBUILD_COMPUTATION_URL=http://127.0.0.1:8000` for the dispatcher.

Run the computation development script, `pnpm computation:worker`, and `pnpm dev` in separate terminals after applying server migrations. Native Windows development enforces subprocess deadlines and cancellation but Linux/container resource limits are required to verify CPU/address-space ceilings.

```sh
pnpm computation:generate
python services/computation/generate_models.py
pnpm computation:check
python services/computation/generate_models.py --check
python -m pytest services/computation
```

Use the service's virtual-environment Python for generation and tests. `SWIFTBUILD_TEST_DATABASE_URL` must end in `_test`; `SWIFTBUILD_COMPUTATION_PYTHON` selects that environment's Python executable for real dispatcher integration and server browser jobs. Unconfigured database/Python suites are explicitly skipped and do not verify integration.

## Health, budgets and failures

Web `/api/health` is process liveness. `/api/v1/ready` validates migrations and, when `SWIFTBUILD_COMPUTATION_ENABLED=1`, dispatcher heartbeat freshness. The dispatcher checks the private Python `/v1/ready` contract version and schema digest before claiming work. Python `/health` remains responsive during computation. Operator heartbeat checks use `pnpm --filter @swiftbuild/server-core exec tsx src/worker-health.ts`.

Python runs one execution at a time with a one-CPU, 512 MiB container ceiling, 64-process ceiling, read-only root filesystem, and bounded temporary storage. Child processes additionally enforce Linux CPU, address-space and output-file limits. BLAS uses one thread. Keep a single dispatcher/computation pair for this first release; multiple dispatchers preserve lease fencing, but a shared busy computation service can cause an attempt to fail.

Timeouts terminate children. Cancellation is polled through the backend every three seconds and removes running work; an expired attempt cannot publish. A known allocation failure is `MEMORY_EXHAUSTED`; an externally killed process is `RESOURCE_EXHAUSTED_OR_KILLED`, since a kill alone does not prove an out-of-memory event. Unavailable/incompatible Python services leave queued work durable. Dispatcher crashes release work through lease expiry. Restarting Python may fail an active request; explicitly rerun failed definitions.

Structured logs contain event, job/attempt/request identifiers, state and stable failure codes. They exclude architecture bodies, measurements, passwords, session cookies and tokens. Keep logs and database backups private. Jobs are durable and not automatically expired; operators must budget storage until a retention policy is implemented.

## Backup and restore

Prefer the [operator backup and recovery drill](recovery.md) commands for binary-safe artifacts, snapshot manifests, corruption checks and runtime-role verification. PostgreSQL dumps are consistent while writes continue; stop web and dispatcher writes when preparing a coordinated deployment cutover. Run PostgreSQL tools inside the database container; retain `server.env` separately and privately. These commands create a backup and a new restore database without overwriting the running database:

```sh
docker compose --env-file server.env -f compose.yaml -f compose.server.yaml exec -T database pg_dump -U postgres -d swiftbuild -Fc > swiftbuild-backup.dump
docker compose --env-file server.env -f compose.yaml -f compose.server.yaml exec -T database createdb -U postgres swiftbuild_restore_test
docker compose --env-file server.env -f compose.yaml -f compose.server.yaml exec -T database pg_restore -U postgres -d swiftbuild_restore_test --no-owner --single-transaction < swiftbuild-backup.dump
```

Use a binary-safe shell for the dump; PowerShell users should run the commands through WSL/POSIX or direct PostgreSQL tools with `--file`, because older PowerShell redirection can alter binary output. Reprovision runtime privileges on the restored database, verify migration checksums, identity admission, revision exports, job results and bundle digests, then validate a replay using the original pinned computation environment. Database recovery includes analysis jobs and attempts; it does not back up browser drafts.

The full-stack smoke script exercises backup into an isolated `_test` restore database and compares revision/job evidence. This is a reproducible recovery test, not point-in-time recovery or production disaster-recovery certification. Restore the matching release rather than editing applied migration history. Never run `down -v` against a deployment whose data must be retained.
