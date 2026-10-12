# SwiftBuild agent guide

SwiftBuild is a semantic Architecture IDE. Every component and connection must mean something to the architecture model. Preserve valid work and inspect relevant source and documentation before editing.

## Boundaries and repository map

`apps/web` owns the server-rendered web shell. `architecture-schema` owns runtime-validated contracts; `architecture-model` owns immutable commands and history; `graph-engine` owns reference and connection validation; `components-core` owns declarative generic primitives; `canvas` owns editor interactions; `ui` and `design-tokens` own shared presentation. Dependencies flow down toward the schema. Core packages must never import apps, billing, authentication, cloud infrastructure, or AI providers.

Where should code go? New entity → schema/model. Structural topology → graph-engine. Workload and simulation → capacity-engine. Engineering policy → rule-engine. Editor behavior, workers and browser adapters → canvas. Shared control → ui. Declarative primitive → components-core. App route → web. Future SDK, CLI, API and providers get packages only when implemented.

Technology/provider definitions, taxonomy, aliases and local pack validation belong in component-registry. Keep semantic types vendor-neutral. Existing embedded definitions remain usable; only explicit lossless conversion may change identity. Shared UI owns local SVG icon presentation. Structural dark surfaces are neutral black/zinc, with semantic colors limited to icons, status, ports and restrained focus/selection.

## Commands and workflow

Read DEVELOPMENT.md. Use `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm format:check`, and `pnpm verify`. Store significant scratch plans under ignored design-notes; rewrite lasting decisions as clean ADRs. Inspect the diff and staged files before committing. Use Conventional Commits.

## Domain conventions

IDs are stable. Layout belongs only in views. Native format is 1.1 with explicit deterministic migration from 1.0; never silently redefine either format. Future formats need migration fixtures and metadata preservation. Component versions remain independent. Definitions need validated defaults, capabilities, directional ports and documentation. Rules return structured evidence and recommendations and must be independently testable. Engines never execute uploaded code or invent missing measurements. Sampling uncertainty is distinct from model accuracy.

## Frontend and backend conventions

Keep the shell server-rendered and interactive canvas client-side. Use semantic tokens, accessible primitives, labeled actions, visible focus, reduced motion, and the parallel object list. Separate transient editor state from persisted documents. Use selective editor-store subscriptions. Commit a drag once.

Browser mode uses transactional IndexedDB, retained legacy drafts and optimistic storage revisions. Checkpoints remain outside current documents. `project-format` owns portable archive contracts. `server-core` owns explicit checksum-verified relational migrations, invite-only identity, transactional server projects and authenticated HTTP services; `apps/web` owns account/project screens, route integration, HTTP adapters and separate local server-project recovery. Core domain packages remain independent of authentication and hosting. Server editor saves use strong revision tags and retained operation IDs; never silently retry stale work against a newer revision. Promotion is explicit and leaves browser drafts intact. Operational deployment and backup/restore remain planned. Never change database structures manually. Derive actors from verified sessions, validate server input, and enforce active admission and workspace permissions inside storage transactions.

## Security and completion

Never commit secrets, private preferences, local research, or generated test outputs. Never execute uploaded extension code. Validate imports before replacement and enforce size limits. No analytics by default. SwiftBuild is the only brand in maintained prose and commit messages. Use neutral capability descriptions and internal documentation links. Preserve exact commands, dependency/API identifiers and required third-party attribution; never rename serialized identities to satisfy prose policy. Keep external research sources in ignored local notes. The local name check lives outside tracked tooling.

PR checklist: coherent package ownership; backward compatibility and migrations considered; useful tests; format, lint, types, tests and build pass; UI keyboard and accessibility checks; docs updated; no secrets or ignored material staged; significant decisions documented. Do not claim checks passed when unavailable.
