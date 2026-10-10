# SwiftBuild agent guide

SwiftBuild is a semantic Architecture IDE. Every component and connection must mean something to the architecture model. Preserve valid work and inspect relevant source and documentation before editing.

## Boundaries and repository map

`apps/web` owns the Next.js shell. `architecture-schema` owns Zod contracts; `architecture-model` owns immutable commands and history; `graph-engine` owns reference and connection validation; `components-core` owns declarative generic primitives; `canvas` owns editor interactions; `ui` and `design-tokens` own shared presentation. Dependencies flow down toward the schema. Core packages must never import apps, billing, authentication, cloud infrastructure, or AI providers.

Where should code go? New entity → schema/model. Topology → graph-engine. Editor behavior → canvas. Shared control → ui. Declarative primitive → components-core. App route → web. Future rules, capacity, SDK, CLI, API and providers get packages only when implemented.

## Commands and workflow

Read DEVELOPMENT.md. Use `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm format:check`, and `pnpm verify`. Store significant scratch plans under ignored design-notes; rewrite lasting decisions as clean ADRs. Inspect the diff and staged files before committing. Use Conventional Commits.

## Domain conventions

IDs are stable. Layout belongs only in views. Never silently change schemaVersion 1.0. Future formats need explicit deterministic migrations with fixture tests and metadata preservation. Component definitions need validated defaults, capabilities, directional semantic ports, and documentation. Future rules return structured reasons and recommendations and must be independently testable; do not invent a rule engine inside UI code.

## Frontend and backend conventions

Keep the shell server-rendered and interactive canvas client-side. Use semantic tokens, accessible primitives, labeled actions, visible focus, reduced motion, and the parallel object list. Separate transient editor state from persisted documents. Use selective Zustand subscriptions. Commit a drag once.

There is no backend/database in this bootstrap. Future persistence uses PostgreSQL through an injected adapter and migrations. Never change database structures manually. Validate at server boundaries and enforce authorization server-side when introduced.

## Security and completion

Never commit secrets, private preferences, local research, or generated test outputs. Never execute uploaded extension code. Validate imports before replacement and enforce size limits. No analytics by default. No reference-product names in public files or commit messages; the local name check lives outside tracked tooling.

PR checklist: coherent package ownership; backward compatibility and migrations considered; useful tests; format, lint, types, tests and build pass; UI keyboard and accessibility checks; docs updated; no secrets or ignored material staged; significant decisions documented. Do not claim checks passed when unavailable.
