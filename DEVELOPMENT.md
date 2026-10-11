# Development

Use runtime major version 24 (`node`) and package manager version 10.28.1 (`pnpm`); follow the root manifest and tracked lockfile rather than an assumed latest release. Commands work in PowerShell and POSIX shells.

```sh
pnpm install
pnpm dev
pnpm verify
pnpm exec playwright install chromium
pnpm test:e2e
```

`dev:web` starts the web development server. `build` runs the workspace builds. `typecheck` checks all packages. `test` and `test:unit` run the unit and numerical reference suites. `lint` includes dependency boundaries. `format` changes formatting; `format:check` checks it. `clean` removes known build outputs. `storybook` previews reusable controls; `build:storybook` builds their documentation.

Install E2E browsers with `pnpm exec playwright install chromium`. On Linux CI use `--with-deps`. Tests start their own application on port 3100. Run `pnpm --filter @swiftbuild/architecture-schema typecheck` for a focused package check.

Browser-local development requires no database or credentials. `.env.example` documents optional server configuration and the web port. Server mode needs a private database connection, identity secret and explicitly applied migrations; see [server setup](docs/self-hosting/README.md). Local research, design notes, test results, and personal agent preferences are ignored. The pnpm lockfile is tracked.

Database integration tests require `SWIFTBUILD_TEST_DATABASE_URL` pointing to an isolated database whose name ends in `_test`. They create and remove generated test schemas; never use a production connection. Without this variable, database tests are skipped. CI supplies the isolated database; the test output reports the current executed and skipped counts. Operator commands use `pnpm server:operator`; account and API routes are documented in the [server API guide](docs/server-api.md).

The browser workspace uses transactional IndexedDB and is specific to the origin. Migration retains the legacy localStorage draft. Export a project archive before clearing site data. Stale tabs cannot overwrite a newer storage revision; export in-memory work before reloading after a conflict. Private security reporting must be configured before public publication.

`pnpm benchmark:capacity` exercises a 1,000-node topology and records hardware, timings, memory and event counts under ignored `.agent-work/`. Unit tests exercise transactional IndexedDB behavior through a test-only implementation; they do not certify every real browser. Engineering changes need numerical reference tests; browser changes need E2E, keyboard and responsive checks. See [engineering documentation](docs/engineering/README.md).

After `pnpm build`, run `pnpm --filter @swiftbuild/web start` to serve the standalone production bundle. Stop this server before rebuilding on Windows; the running bundle directory can be locked.
