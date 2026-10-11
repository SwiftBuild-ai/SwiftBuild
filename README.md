# SwiftBuild

An open-source Architecture IDE and System Design Workbench. Design systems with components and connections that carry engineering meaning.

![SwiftBuild neutral black architecture canvas with technology catalog and database configuration](docs/assets/workbench.png)

[View the light theme](docs/assets/workbench-light.png). Both workbench captures use a 1487 by 1058 viewport. These are existing product illustrations, not fresh verification captures.

## Start locally

Requires runtime major version 24 (`node`) and package manager version 10.28.1 (`pnpm`). These versions follow the repository manifests.

```sh
pnpm install
pnpm dev
```

Open http://localhost:3000. The workbench restores your browser workspace or starts with an empty architecture. Search the component catalog, choose the commerce template, or use the engineering example to explore scenarios and simulation. Example measurements are explicitly illustrative.

## Workbench capabilities

- Versioned architecture schema with stable IDs and separate layout data
- Generic clients, services, workers, load balancers, databases, caches, queues and boundaries
- Direct infrastructure technology selection, contextual configuration and local SVG identity across 35 technologies/provider services
- Searchable taxonomy, technology/generic filters, favorites, recents, details, drag/keyboard insertion and validated local component packs
- Canvas navigation, grouping, selection, duplication, deletion, and undo/redo
- Transactional browser workspace, validated native JSON and project archives, and recoverable named checkpoints
- Accessible object list, keyboard shortcuts, and light/dark themes
- Default neutral black/zinc dark surfaces, retained light theme and preference restoration before hydration
- Persistent searchable catalog, portable custom components based on validated primitives, canvas locking, and activity logs
- Linked requirements, decision records, evidence-based assessments and deterministic engineering findings
- Workload scenarios, growth and bursts, analytical topology propagation and seeded discrete-event simulation
- Explicit service/CPU/memory behavior, cache routing, queue delivery, retries, timeouts and dependency joins
- Explainable results, saved run comparisons, canvas overlays and semantic/layout checkpoint comparisons

Work stays in this browser and origin. Export a project archive to preserve checkpoints and engineering evidence. Missing measurements remain unknown; simulation results describe the supplied model and do not replace production load testing. Read the [engineering guide](docs/engineering/README.md) for supported behavior and limitations. Accounts, durable server projects, collaboration, YAML/CLI, deployment integration and AI assistance are planned in the [full product roadmap](docs/roadmap.md). Self-hosting currently serves the web application; it does not add server project storage.

![SwiftBuild scenario simulation with explicitly illustrative inputs](docs/assets/capacity.png)

## Development and contribution

The [current status](docs/status.md) records implemented capabilities, limitations and dated verification. Read [DEVELOPMENT.md](DEVELOPMENT.md), [CONTRIBUTING.md](CONTRIBUTING.md), and [AGENT.md](AGENT.md). Browse the [documentation hub](docs/README.md) for architecture, engineering, recovery and planned work. Run `pnpm verify` before proposing changes and `pnpm test:e2e` for editor changes.

## Self-host

```sh
docker compose up --build
```

See [self-hosting](docs/self-hosting/README.md). No managed service is required.

## Security and license

See [SECURITY.md](SECURITY.md). Licensed under Apache-2.0. Bundled font and icon notices are listed in [NOTICE](NOTICE).
