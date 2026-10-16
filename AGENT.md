# SwiftBuild agent guide

SwiftBuild is a semantic Architecture IDE. Every component and connection must mean something to the architecture model. Preserve valid work and inspect relevant source and documentation before editing.

## Boundaries and repository map

`apps/web` owns the server-rendered web shell. `architecture-schema` owns runtime-validated contracts; `architecture-model` owns immutable commands and history; `graph-engine` owns reference and connection validation; `components-core` owns declarative generic primitives; `canvas` owns editor interactions; `ui` and `design-tokens` own shared presentation. Dependencies flow down toward the schema. Core packages must never import apps, billing, authentication, cloud infrastructure, or AI providers.

Where should code go? New entity → schema/model. Structural topology → graph-engine. Workload and simulation → capacity-engine. Engineering policy → rule-engine. Editor behavior, workers and browser adapters → canvas. Shared control → ui. Declarative primitive → components-core. App route → web. Future SDK, CLI, API and providers get packages only when implemented.

Technology/provider definitions, taxonomy, aliases and local pack validation belong in component-registry. Keep semantic types vendor-neutral. Existing embedded definitions remain usable; only explicit lossless conversion may change identity. Shared UI owns local SVG icon presentation. Structural dark surfaces are neutral black/zinc, with semantic colors limited to icons, status, ports and restrained focus/selection.

## Commands and workflow

Read DEVELOPMENT.md. Use `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm format:check`, and `pnpm verify`. Store significant scratch plans under ignored design-notes; rewrite lasting decisions as clean ADRs. Inspect the diff and staged files before committing. Use Conventional Commits.

Use the focused branch prefixes in [CONTRIBUTING.md](CONTRIBUTING.md). Commit each coherent, verified documentation change or feature slice separately. Avoid combining unrelated packages or roadmap milestones in one PR. When publication and merging are authorized, push the branch, open a PR, wait for both `verify` and `docker-smoke`, then merge the exact checked head with a regular merge commit, preserving the individual commits. Use `gh pr merge --merge --match-head-commit FULL_SHA`; do not squash or rebase unless the user explicitly requests it. Keep a parent branch until every open dependent PR has been retargeted. Synchronize `main` after merging; account for historical squash merges when auditing older branches. Honor any task-specific request to review the draft before committing.

## Review and issue triage

Inspect package contracts, source, tests, accepted ADRs and existing issues before proposing work. Distinguish reproduced defects, missing regression coverage, documented limitations and planned features. Record the reviewed revision and reproducible evidence without private data. Follow [issue guidance](docs/contributor-issues.md) when opening contributor tasks: use `good first issue` only for bounded work with clear entry points, and `difficulty: medium` for work needing cross-module reasoning or failure-path design. Give every issue an outcome, scope, prerequisites, completion criteria and relevant verification commands. Do not publish vulnerabilities or private reporting details in public issues.

## Domain conventions

IDs are stable. Layout belongs only in views. Native format is 1.1 with explicit deterministic migration from 1.0; never silently redefine either format. Future formats need migration fixtures and metadata preservation. Component versions remain independent. Definitions need validated defaults, capabilities, directional ports and documentation. Rules return structured evidence and recommendations and must be independently testable. Engines never execute uploaded code or invent missing measurements. Sampling uncertainty is distinct from model accuracy.

## Frontend and backend conventions

Server ownership is Python in `services/backend`: HTTP, identity, SQL repositories, migrations, jobs, capacity calculations and operators. Next.js owns rendering and transparent HTTP adapters; its process needs only the private backend origin. `packages/server-core` remains temporarily for legacy compatibility fixtures, with no web runtime dependency. This supersedes the server-core ownership wording below; see [ADR 0012](docs/adr/0012-python-backend.md). Verify Python parity and generated contracts alongside the existing suites. Full-server Compose uses Python API/dispatcher/operator services and native recovery/restart smoke; production routing and rolling-cutover certification remain deferred.

Keep the shell server-rendered and interactive canvas client-side. Use semantic tokens, accessible primitives, labeled actions, visible focus, reduced motion, and the parallel object list. Separate transient editor state from persisted documents. Use selective editor-store subscriptions. Commit a drag once.

Browser mode uses transactional IndexedDB, retained legacy drafts and optimistic storage revisions. Checkpoints remain outside current documents. `project-format` owns portable archive contracts. `server-core` owns explicit checksum-verified relational migrations, invite-only identity, transactional server projects and authenticated HTTP services; `apps/web` owns account/project screens, route integration, HTTP adapters and separate local server-project recovery. Core domain packages remain independent of authentication and hosting. Server editor saves use strong revision tags and retained operation IDs; never silently retry stale work against a newer revision. Promotion is explicit and leaves browser drafts intact. Optional full-server deployment and isolated backup/restore smoke are implemented; production operational recovery still needs validation. Never change database structures manually. Derive actors from verified sessions, validate server input, and enforce active admission and workspace permissions inside storage transactions.

Keep browser-local mode independent of accounts and infrastructure. Server mode supports local passwords and optional configured organizational sign-in, with private operator-issued one-time invitation and recovery links. Do not introduce a mandatory mail server. Creation retry recovery across reload, dedicated immutable revision restoration and private bootstrap-link rotation are implemented; preserve their recovery, permission and race tests. Production operational recovery remains a separate roadmap gate. Database and server browser tests require an isolated `_test` database; a skipped suite is not a pass. Use the dedicated configuration in DEVELOPMENT.md for server browser changes.

## Security and completion

Never commit secrets, private preferences, local research, or generated test outputs. Never execute uploaded extension code. Validate imports before replacement and enforce size limits. No analytics by default. SwiftBuild is the only brand in maintained prose and commit messages. Use neutral capability descriptions and internal documentation links. Preserve exact commands, dependency/API identifiers and required third-party attribution; never rename serialized identities to satisfy prose policy. Keep external research sources in ignored local notes. The local name check lives outside tracked tooling.

PR checklist: coherent package ownership; backward compatibility and migrations considered; useful tests; format, lint, types, tests and build pass; UI keyboard and accessibility checks; docs updated; no secrets or ignored material staged; significant decisions documented. Do not claim checks passed when unavailable.
