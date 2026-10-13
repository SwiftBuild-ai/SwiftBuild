# SwiftBuild full product roadmap

Status reviewed October 13, 2026. SwiftBuild's target is a complete open-source architecture engineering platform for individual developers, architects and engineering teams: design, validate, simulate, review, version and maintain systems. Every planned capability below remains part of that target. No delivery dates are implied; partial implementation does not complete a milestone.

## Implemented foundation

Native format 1.1 with explicit 1.0 migration; embedded definitions and separate view layout; semantic editing and undo/redo; linked requirements and decisions; workload scenarios; analytical propagation; seeded bounded simulation; deterministic evidence-based findings; transactional browser workspaces; immutable checkpoints; validated project archives and comparison.

The catalog contains 35 concrete technology/provider definitions, 26 cataloged generic definitions and eight retained core primitives. Search, aliases, favorites, recents, details, keyboard/drag insertion, contextual configuration, local declarative JSON packs and explicit legacy conversion are implemented. Neutral black/zinc dark surfaces are the default; light mode and restored preferences remain available.

The engines support declared service, database, cache, queue and router behavior. Recursive feedback paths, unattributed initial backlog, absent measurements and out-of-range curves remain unevaluated. Independent browser drafts and optional server editing are implemented, with transactional revisions, explicit migrations, invite-only identity, authorization, recovery and saved-draft promotion. Account screens consume operator-issued links without a mail server. See [current status](status.md), [server API](server-api.md) and [model limitations](engineering/capacity.md).

## Dependency order and completion gates

Milestones 1 and 6 are **in progress**; milestones 2–5 and 7–8 are **planned**. The critical path is durable authenticated server projects → shared review → safe concurrent editing. Architecture-as-code and calibrated modeling can proceed alongside team work after their stated prerequisites. Implement coherent vertical slices and preserve existing browser workflows throughout.

### 1. Durable server projects and operational foundation

Status: **in progress**. Implemented slices: shared archive contracts, checksum-verified transactional migrations, durable server revisions/audit events, invite-only identity, role enforcement, operator-issued recovery, authenticated HTTP routes, account/project screens, server editing, immutable history exports and explicit complete saved-draft promotion. Browser recovery preserves uncertain operations and stale/offline edits; viewer previews remain local. This release adds leased engineering jobs, a private Python computation supervisor, an optional full-server Compose configuration, runtime-role provisioning and a backup/restore smoke workflow. Creation retries now survive reload, prior archives can be restored as new attributable revisions, and operators can rotate unused bootstrap links. Operator backup manifests and isolated runtime-role recovery tooling are implemented; their container drill is included in required hosted CI verification. Remaining gates include deployment-specific production operational recovery validation. Accepted decisions and implementation evidence are linked from [current status](status.md).

Prerequisite: retain current schema, migration, archive and injected storage contracts; record the server persistence and security design before implementing it.

Outcome: a maintainable modular, self-hostable backend with a transactional relational database, durable projects and workspaces, document APIs, authentication, user management, server-enforced project/workspace permissions, architecture revisions, audit events and import/export. Browser storage remains available for drafts. Add validation/simulation jobs where isolation, cancellation and resource budgets are needed; queues, caches and object storage require demonstrated requirements.

Complete when authorized users can create, save and reopen projects across browser and server restarts; unauthorized and cross-workspace reads/writes are rejected; invalid or stale writes preserve valid work; imports preserve stable IDs and metadata; migrations are tested against old fixtures; and recovery is demonstrated from backups. Publish API contracts, secure configuration, local setup, deployment instructions, health/readiness checks, job failure handling and structured operational logs without recording sensitive document contents.

### 2. Shared workspaces and architecture review

Prerequisite: milestone 1 permission, revision and audit contracts.

Outcome: workspace membership, roles, project permissions, comments, architecture change proposals, requirement/decision traceability, review states and activity history connected to durable revisions. Include impact analysis and explainable comparisons for reviewers.

Complete when membership changes enforce access server-side, review discussions reference the intended revision, accepted proposals create attributable revisions, conflicts do not overwrite intervening work, and keyboard users can complete review tasks. Test revoked access, deleted entities, stale proposals and recovery from interrupted requests.

### 3. Safe concurrent editing

Prerequisite: milestones 1–2 durable state, authorization and review semantics; an accepted consistency/conflict-resolution decision.

Outcome: concurrent editing, presence and collaboration indicators with explicit conflict handling, reconnect behavior and durable convergence. Preserve semantic validity and separate shared architecture edits from personal view preferences.

Complete when concurrent node, edge, configuration and deletion changes converge under the chosen policy; reconnects reconcile committed state; stale clients cannot bypass permissions; duplicate delivery is safe; and disconnects expose unsaved work. Test multi-client conflicts, reordered messages, role revocation and server restarts. Presence must not substitute for durable state or permission enforcement.

### 4. Architecture-as-code and automated architecture tests

Prerequisite: existing pure domain engines, stable versions and deterministic migration; milestone 1 only for authenticated remote operations.

Outcome: JSON/YAML adapters, command-line validation and simulation, import/export, architecture diffing, Git-friendly representation and CI integration using the same semantic model. Support reproducible architecture tests without opening the editor.

Complete when editor and command-line inputs produce equivalent validation and seeded results, layout-only changes are separately identified, unsupported versions fail safely, and old-file migration/round-trip fixtures retain metadata. Document commands, exit statuses, machine-readable results, resource limits and compatibility policy. No separate competing native model is introduced.

### 5. Contributor extension ecosystem

Prerequisite: current declarative pack validation and stable component contracts; milestone 4 for reusable package verification, milestone 1 for any authenticated distribution service.

Outcome: standalone component and rule SDKs, versioned extension manifests, provider packs, example extensions, community templates, component documentation, registry validation, remote distribution, publisher verification and compatibility-aware upgrades. Keep generic primitives available.

Complete when contributors can validate, test, distribute and explicitly upgrade extensions independently; incompatible configurations and ports retain valid existing documents; provenance and licensing travel with packs; and unknown capabilities remain explicit. Declarative imports stay non-executable. Any executable extension requires a separately accepted isolation/permission design and adversarial tests before support is claimed.

### 6. Calibrated capacity and failure analysis

Status: **in progress**. Stationary reliability, shared failure groups, forced-outage impact and bounded sensitivity jobs are implemented as a focused slice. Outage timelines, richer distributions, calibrated resource sharing and the other completion gates remain planned. See [engineering analysis](engineering/analysis.md).

Prerequisite: current scenario, provenance, behavior and numerical-reference contracts. Depends on milestone 1 for durable shared jobs and measurement ingestion services, not for pure engine improvements.

Outcome: representative measurement ingestion, independently verified resource-sharing models, attributed initial backlog, replication overhead, failure distributions, failure-mode analysis, scenario comparison and sensitivity analysis. Extend declared active-user, traffic, growth, payload, retention, concurrency, latency and availability objectives where supported semantics are missing. Add custom deterministic rules and explicit suppression policies with traceable reasons.

Complete when each added behavior has explicit units and provenance, hand-calculated or independently derived references, applicability bounds, deterministic replay and cancellation/resource-budget tests. Reports distinguish sampling variation from model error, show unsuccessful/outstanding work, and never infer measured throughput or availability guarantees from component names. Test overload, unsupported topology, incomplete evidence, model changes and stale assessments.

### 7. Architecture lifecycle, imports and engineering reports

Prerequisite: milestone 4 semantic diff and reproducible tests; milestones 1–2 for durable team workflows; milestone 6 for any new calibrated report claims.

Outcome: deployment-manifest and infrastructure-as-code import, declared-versus-observed drift detection, model consistency checks, service-dependency exploration, reusable architecture patterns, architecture comparison, connected engineering reports and automated reviews. Architecture design remains manual. Deterministic analysis and review produce inspectable evidence; the open-source product does not adopt AI.

Complete when imports preview their mappings and unsupported constructs before replacement, retain source provenance, and never silently execute deployment actions. Drift comparisons identify observation scope and time; reports trace requirements, decisions, findings and simulation inputs. Automated proposals require validation, preserve permissions and history, and expose uncertainty. Test partial observations, incompatible versions, import failures and rejected proposals.

### 8. Complete the professional editor workflow

Prerequisite: existing semantic commands, view layout and accessible object navigation; milestone 2 for shared review navigation.

Outcome: close remaining gaps in copy/paste, edge-label editing, multi-selection, alignment/distribution, snap-to-grid, architecture navigation and contextual menus. Extend environment, region and infrastructure-boundary editing where the model already has contracts, and add compatible contracts only where necessary. Keep canvas interactions connected to semantic validation, requirements and engineering evidence.

Complete when each operation uses validated undoable commands, preserves stable IDs and compatible references, works through keyboard or accessible alternative controls, and survives save/reload. Verify grouping, narrow layouts, large-graph interaction, light/dark themes, focus restoration and reduced motion. Audit current support before adding controls; this milestone does not imply that every listed operation is absent today.

## Quality gates for every milestone

- Preserve strict types, runtime validation, stable IDs, semantic/layout separation, explicit migrations and backwards-compatible fixtures. Schema versions, component versions and archive/pack versions stay independent.
- Preserve neutral structural themes and local assets. Verify keyboard and non-drag operation, visible focus, contrast, accessible names, reduced motion, narrow layouts and understandable empty/error/recovery states. Establish internationalization readiness without claiming a full accessibility certification.
- Define measured performance budgets for editor interactions, large graphs, imports and jobs, recording hardware and workload. Include cancellation, error boundaries, structured logs, metrics/tracing and bounded resource usage where needed. No product analytics by default.
- Test security boundaries, sessions, permissions, input limits, isolation, supply-chain changes and backup/restore. Operational and compliance claims require evidence; unknowns remain explicit.
- Run relevant unit, numerical, integration, browser, migration and deployment checks. Document passed, failed and unverified results; provide reproducible setup, API compatibility and rollback/recovery instructions.
- Configure verified private security and conduct reporting, maintain contributor-friendly documentation and retain required third-party attribution before expanding public participation.

A milestone is complete only when its real workflow, data contracts, applicable backend/permissions, persistence, failure handling, tests, UX and documentation work together. A roadmap entry, empty package or visible control is not completion evidence.
