# SwiftBuild architecture

The native JSON document is canonical. Nodes contain architecture semantics; views contain layout. Embedded versioned declarative definitions make documents portable without a registry service. [Native format](native-format.md) defines versions and import boundaries.

## Package ownership and dependencies

Runtime workspace imports flow toward domain contracts. The diagram includes direct package dependencies, not just the main conceptual chain; test-only dependencies are excluded.

```mermaid
graph TD
  web --> canvas
  web --> ui
  web --> tokens[design-tokens]
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

Core packages do not depend on hosting, accounts or a server database. UI owns local SVG presentation without registry or architecture dependencies. Registry identity extends embedded definitions without replacing semantic types. Package boundaries are enforced by `pnpm boundaries`.

## Current data flow

The editor owns validated immutable documents, bounded undo history, selection and transient interaction state. Commands update model semantics or view layout; a drag commits once. Structural validation is separate from engineering policy evaluation. Simulation runs in a cancellable browser worker and returns versioned reports with input fingerprints, provenance and incomplete states.

The injected `WorkspaceAdapter` reads and writes validated project archives asynchronously. The browser implementation atomically persists current work, external checkpoint bodies and run summaries with optimistic storage revisions. Legacy drafts are retained after migration. Stale tabs cannot silently overwrite newer saves; failed writes leave work exportable. Preferences are separate from transactional architecture data.

Requirements, decisions, scenarios, declarative local packs, engineering findings, semantic comparisons and named checkpoints are implemented workflows. A supported generic behavior does not establish provider-specific performance. See [engineering methods](../engineering/README.md) and [current status](../status.md).

## Target architecture

A complete self-hostable backend is required by the [roadmap](../roadmap.md). Future server adapters must preserve domain contracts while adding durable projects, migrations, authorization and revision conflict handling. Shared review and concurrent editing depend on that foundation. Do not introduce future packages or document hypothetical endpoints as existing APIs.

Accepted decisions live in [the decision records](../adr/0001-native-architecture-format.md). Their status records actual decisions, not completion of every future consequence. New implementation decisions require their own records; roadmap proposals do not supersede accepted history.
