# SwiftBuild architecture

The native JSON document is canonical. Nodes contain architecture semantics; views contain layout. Embedded versioned declarative definitions make documents portable without a registry service. [Native format](native-format.md) defines versions and import boundaries.

## Package ownership and dependencies

Runtime workspace imports flow toward domain contracts. The diagram includes direct package dependencies, not just the main conceptual chain; test-only dependencies are excluded.

```mermaid
graph TD
  web --> canvas
  web --> ui
  web --> tokens[design-tokens]
  web --> primitives[components-core]
  web -. HTTP .-> server[Python FastAPI backend]
  server -. generated contracts .-> schema[architecture-schema]
  canvas --> archives
  archives --> schema[architecture-schema]
  archives --> model[architecture-model]
  archives --> graph[graph-engine]
  archives --> capacity[capacity-engine]
  canvas --> schema[architecture-schema]
  canvas --> model[architecture-model]
  canvas --> graph[graph-engine]
  canvas --> primitives[components-core]
  canvas --> registry[component-registry]
  canvas --> capacity[capacity-engine]
  canvas --> rules[rule-engine]
  canvas --> ui
  canvas --> tokens
  registry --> primitives
  registry --> schema
  primitives --> schema
  rules --> capacity
  rules --> graph
  rules --> model
  rules --> schema
  capacity --> graph
  capacity --> model
  capacity --> schema
  graph --> model
  graph --> schema
  model --> schema
  ui --> tokens
```

| Owner                                   | Responsibility                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `architecture-schema`                   | Runtime validation, static contracts, native migration and metadata preservation                             |
| `architecture-model`                    | Immutable commands, history, semantic fingerprints and checkpoint comparison                                 |
| `graph-engine`                          | References, port compatibility, configuration and structural integrity                                       |
| `components-core`, `component-registry` | Generic primitives, concrete infrastructure declarations, taxonomy and local pack validation                 |
| `capacity-engine`, `rule-engine`        | Workload and topology calculations, seeded simulation, deterministic policies and evidence-based assessments |
| `canvas`                                | Editor interactions, per-instance store, browser adapters and worker orchestration                           |
| `ui`, `design-tokens`                   | Shared accessible controls, local icons and semantic presentation tokens                                     |
| `apps/web`                              | Server-rendered shell, application routes and bundled assets                                                 |
| `project-format`                        | Host-independent validated archives, byte limits and asynchronous storage contract                           |
| `services/backend`                      | Server identity, transactional persistence, migrations, jobs, calculations, operators and HTTP boundaries    |

`server-core` remains temporarily as legacy compatibility/reference code. Next.js depends on a typed HTTP adapter rather than the relational or identity implementation. Python semantic validation and capacity calculations are checked against TypeScript fixtures. See [ADR 0012](../adr/0012-python-backend.md).

Core packages do not depend on hosting, accounts or a server database. UI owns local SVG presentation without registry or architecture dependencies. Registry identity extends embedded definitions without replacing semantic types. Package boundaries are enforced by `pnpm boundaries`.

## Current data flow

The editor owns validated immutable documents, bounded undo history, selection and transient interaction state. Commands update model semantics or view layout; a drag commits once. Structural validation is separate from engineering policy evaluation. Simulation runs in a cancellable browser worker and returns versioned reports with input fingerprints, provenance and incomplete states.

The injected `WorkspaceAdapter` reads and writes validated project archives asynchronously. The browser implementation atomically persists current work, external checkpoint bodies and run summaries with optimistic storage revisions. Legacy drafts are retained after migration. Stale tabs cannot silently overwrite newer saves; failed writes leave work exportable. Preferences are separate from transactional architecture data.

The optional server stores immutable numbered archive revisions with membership-checked transactional writes and audit events. Identity uses invite-only local accounts and configured organizational OIDC, database sessions and explicit account linking. The web host exposes account/project screens and an authenticated [HTTP API](../server-api.md). Project saves require strong revision tags and retry operation IDs. Server project IDs remain separate from embedded model IDs. See [storage](../adr/0007-server-project-storage.md) and [identity](../adr/0008-invite-only-identity.md) decisions.

The host mounts the canvas through a stable injected storage binding and initial authorized archive. A separate transactional recovery database retains the latest archive and any uncertain operation payload by user/project key. The retained operation is resolved before a newer save; conflicts stop network writes and preserve later local edits. On reopen, unsaved recovery requires an explicit export, separate-project save or discard choice. Viewer previews save only to local recovery. Saved-draft promotion reads and copies a validated complete archive without writing back to the local draft. Cache keys isolate records but do not replace server authorization or establish shared-device confidentiality.

Requirements, decisions, scenarios, declarative local packs, engineering findings, semantic comparisons and named checkpoints are implemented workflows. A supported generic behavior does not establish provider-specific performance. See [engineering methods](../engineering/README.md) and [current status](../status.md).

## Target architecture

A complete self-hostable backend is required by the [roadmap](../roadmap.md). Storage, identity, HTTP routes, server editor integration and explicit saved-draft promotion are implemented. Repeatable full deployment, least-privilege provisioning and operational backup/restore remain unfinished. Shared review and concurrent editing depend on that completed foundation. Do not introduce future packages or document hypothetical endpoints as existing APIs.

Accepted decisions live in [the decision records](../adr/0001-native-architecture-format.md). Their status records actual decisions, not completion of every future consequence. New implementation decisions require their own records; roadmap proposals do not supersede accepted history.
