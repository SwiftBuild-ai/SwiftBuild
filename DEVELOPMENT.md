# Development

Use Node.js 24 and pnpm 10.28.1. Commands work in PowerShell and POSIX shells.

```sh
pnpm install
pnpm dev
pnpm verify
pnpm test:e2e
```

`dev:web` starts Next.js. `build` runs the workspace builds. `typecheck` checks all packages. `test` and `test:unit` run Vitest. `lint` includes dependency boundaries. `format` changes formatting; `format:check` checks it. `clean` removes known build outputs. `storybook` previews reusable controls; `build:storybook` builds their documentation.

Install E2E browsers with `pnpm exec playwright install chromium`. On Linux CI use `--with-deps`. Tests start their own application on port 3100. Run `pnpm --filter @swiftbuild/architecture-schema typecheck` for a focused package check.

No database or credentials are required. `.env.example` documents the web port. Local research, design notes, test results, and personal agent preferences are ignored. The pnpm lockfile is tracked.

The browser draft uses one storage key and is specific to the origin. Export before clearing site data. Private security reporting must be configured before public publication.

After `pnpm build`, run `pnpm --filter @swiftbuild/web start` to serve the standalone production bundle. Stop this server before rebuilding on Windows; the running bundle directory can be locked.
