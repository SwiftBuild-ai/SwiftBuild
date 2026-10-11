# Architecture

The native JSON document is canonical. Nodes contain architecture semantics; views contain layout. Embedded versioned declarative definitions make documents portable without a registry dependency.

Dependency direction: web → canvas → capacity/rules/graph → model → schema. Capacity depends on structural validation and model fingerprints; rules may consume current capacity reports. components-core depends on schema. ui depends on design-tokens. No core package depends on a host or user account.

component-registry depends on schema and components-core. It owns infrastructure definitions and declarative pack validation. Technology identity extends embedded definitions without replacing semantic types. UI owns local SVG presentation and has no registry or architecture dependency.

```mermaid
graph TD
  web --> canvas
  canvas --> registry[component-registry]
  registry --> primitives[components-core]
  registry --> schema[architecture-schema]
  primitives --> schema
  canvas --> rules[rule-engine]
  rules --> capacity[capacity-engine]
  capacity --> graph[graph-engine]
  graph --> model[architecture-model]
  model --> schema
  canvas --> ui
  ui --> tokens[design-tokens]
```

The editor owns a per-instance store with validated immutable documents, bounded undo history, selection and transient interaction state. Browser persistence is an injected transactional IndexedDB adapter. Graph integrity validation is distinct from engineering policy evaluation. Simulation runs in a cancellable worker and returns versioned explainable reports.

Requirements, decisions, workload scenarios, topology simulation, deterministic findings and named checkpoints are current workflows. See [native format](native-format.md) and [engineering](../engineering/README.md). Later workstreams cover extension distribution, YAML/CLI, server projects, providers, collaboration and AI.
