# Development

Use runtime major version 24 (`node`) and package manager version 10.28.1 (`pnpm`); follow the root manifest and tracked lockfile rather than an assumed latest release. Commands work in PowerShell and POSIX shells.

Server HTTP, identity, storage, workers and operators now run Python 3.12 in [services/backend](services/backend/README.md). Install its pinned development lock, apply migrations explicitly, and run `pnpm backend:dev` separately from `pnpm dev`. The web process needs only `SWIFTBUILD_BACKEND_URL`; private database/identity settings belong in Python processes. Run `pnpm backend:check`, `pnpm backend:lint` and `pnpm backend:test` alongside `pnpm verify`. Native Python entry points and the server/operator container images work without Node. The TypeScript server package remains temporarily as a compatibility reference. Full-server Compose and its disposable native recovery/restart smoke are described in the [deployment guide](docs/self-hosting/computation.md); production cutover certification remains deferred.

Optional engineering computations use Python 3.12 with pinned runtime/developer locks. See [worker setup](docs/self-hosting/computation.md). Run `pnpm computation:check`, the service's `generate_models.py --check`, and its pytest suite alongside the TypeScript checks. Set `SWIFTBUILD_COMPUTATION_PYTHON` to the virtual-environment Python executable for real dispatcher and server browser tests. Test databases remain isolated `_test` databases. Run `sh tooling/scripts/server-smoke.sh` for the full Compose deployment and backup/restore check in a disposable test deployment.

```sh
pnpm install
pnpm dev
pnpm verify
pnpm exec playwright install chromium
pnpm test:e2e
```

`dev:web` starts the web development server. `build` runs the workspace builds. `typecheck` checks all packages. `test` and `test:unit` run the unit and numerical reference suites. `lint` includes dependency boundaries. `format` changes formatting; `format:check` checks it. `clean` removes known build outputs. `storybook` previews reusable controls; `build:storybook` builds their documentation.

`pnpm test:tooling` runs isolated fixtures for repository tooling and is included in `pnpm test` and `pnpm verify`. `pnpm boundaries` uses the TypeScript syntax tree to inspect static imports, type imports, re-exports and literal dynamic imports in package source. It ignores comments and string contents, enforces the declared dependency direction, and resolves relative paths to reject imports outside the owning package on Windows and POSIX. Computed dynamic imports, runtime `require` calls and symlink targets are not evaluated; use public static package imports for cross-package dependencies. Test files remain outside the source dependency scan.

`pnpm docs:check`, included in `pnpm verify`, checks local targets in tracked Markdown inline/reference links and quoted HTML image sources. It accepts encoded paths, angle-bracket paths containing spaces and directory targets. Fragments are separated from paths; heading/HTML anchors are not validated. External URLs are never fetched. Code spans, fenced examples, comments, historical changelogs/release notes and legal attribution files are excluded. This is a target-existence check for conventional Markdown, not a complete Markdown/HTML parser.

Install E2E browsers with `pnpm exec playwright install chromium`. On Linux CI use `--with-deps`. Tests start their own application on port 3100. Run `pnpm --filter @swiftbuild/architecture-schema typecheck` for a focused package check.

Browser-local development requires no database or credentials. `.env.example` documents optional server configuration and the web port. Server mode needs a private database connection, identity secret and explicitly applied migrations; see [server setup](docs/self-hosting/README.md). Local research, design notes, test results, and personal agent preferences are ignored. The pnpm lockfile is tracked.

Database integration tests require `SWIFTBUILD_TEST_DATABASE_URL` pointing to an isolated database whose name ends in `_test`. They create and remove generated test schemas; never use a production connection. Without this variable, database tests are skipped. CI supplies the isolated database; the test output reports the current executed and skipped counts. Operator commands use `pnpm server:operator`; account and API routes are documented in the [server API guide](docs/server-api.md).

After a successful build, run `pnpm exec playwright test --config playwright.server.config.ts` with that isolated test connection for the production server browser suite. It generates a private identity secret and unique schema, applies trusted migrations, starts a separate host on port 3200, and removes its schema at teardown. It checks credential hydration, durable editing, revision exports/restoration, uncertain creation/restore reload retries, stale/offline recovery, complete saved-draft promotion and viewer restrictions. Default `pnpm test:e2e` runs browser-local regressions and explicitly skips these server fixtures; CI runs both configurations. Fresh server captures are retained as verification artifacts, outside tracked source.

Browser-local traces/results use `test-results/local`; server traces/results use `test-results/server`, so concurrent runs cannot clear each other's artifacts. The dedicated server fixture gives the web process only its backend origin; database and identity settings remain in the separate Python processes. Numerical integration tests launch the private supervisor over real HTTP, including on Windows where the database and subprocess event loops differ.

The browser workspace uses transactional IndexedDB and is specific to the origin. Migration retains the legacy localStorage draft. Export a project archive before clearing site data. Stale tabs cannot overwrite a newer storage revision; export in-memory work before reloading after a conflict. Private security reporting must be configured before public publication.

`pnpm benchmark:capacity` exercises a 1,000-node topology and records hardware, timings, memory and event counts under ignored `.agent-work/`. Unit tests exercise transactional IndexedDB behavior through a test-only implementation; they do not certify every real browser. Engineering changes need numerical reference tests; browser changes need E2E, keyboard and responsive checks. See [engineering documentation](docs/engineering/README.md).

After `pnpm build`, run `pnpm --filter @swiftbuild/web start` to serve the standalone production bundle. Stop this server before rebuilding on Windows; the running bundle directory can be locked.
