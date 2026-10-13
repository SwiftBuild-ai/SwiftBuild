# Architecture engineering

SwiftBuild connects requirements, decisions, capacity evidence, deterministic findings and named checkpoints to the same semantic architecture. Use the engineering example in Architecture templates to explore the workflow. Its numbers are explicitly illustrative.

## Workflow

1. Define requirements and measurable nonfunctional goals. Link affected objects.
2. Record decisions, alternatives, rationale, consequences and requirement links.
3. Create workload scenarios with explicit entry points, traffic classes, growth, peaks, bursts and targets.
4. Supply component profiles and connection policies. A connection alone does not imply one call.
5. Estimate workload, analyze offered topology demand, then simulate temporal behavior and contention.
6. Inspect formulas, assumptions, provenance, unknown coverage, failures, drops and outstanding work. Compare saved runs before accepting findings.
7. Save a checkpoint before major changes. Export the project archive to preserve history and evidence.

Manual reviews require evidence and are invalidated by semantic changes. Calculated assessments require a complete matching result. Layout changes do not invalidate evidence. Imported runs are historical until recomputed locally; matching fingerprints alone do not make imported results authoritative.

## Methods and boundaries

See [capacity models](capacity.md), [worked example](example.md), [measurement CSV](measurements.md), [rule evaluation](rules.md) and [native format](../architecture/native-format.md).

The web shell is server-rendered. Engines are pure typed packages with no UI-framework, storage, account or hosting dependency. Simulation executes in a cancellable worker. Declarative imports cannot execute code. Supported behaviors are published by `behaviorRegistry`; new behaviors require contracts, numerical references and independently verified engine implementations.

## Subsequent workstreams

Server projects and authorization, collaboration, provider deployments and calibrated vendor models, a standalone extension SDK, YAML/CLI, remote registry distribution are separate workstreams. Server-backed reliability and sensitivity jobs are described in [engineering analysis](analysis.md). The open-source product uses manual design without AI adoption. Local declarative packs, topology simulation, scenario planning, deterministic rules, semantic comparisons and browser checkpoints are implemented here. The target includes a complete self-hostable backend and team workflows; none is implied by current browser persistence. See the [roadmap](../roadmap.md) and [current status](../status.md).
