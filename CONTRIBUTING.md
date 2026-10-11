# Contributing

Install the prerequisites in [DEVELOPMENT.md](DEVELOPMENT.md), fork and clone the repository when a remote is available, then run `pnpm install` and `pnpm dev`.

Use a focused `feat/`, `fix/`, `docs/`, `refactor/`, or `chore/` branch. Use Conventional Commits and keep changes coherent. Submit the PR template with motivation, verification, and screenshots for UI changes. Normal PRs use squash merge.

## Contribution paths

- Documentation: improve onboarding and architecture explanations.
- Templates: propose a schema-valid JSON example under `examples/` with a clear purpose.
- Components: keep vendor-neutral primitives in `components-core`; add technologies, taxonomy and validated local packs in `component-registry`, with defaults, ports, documentation, and tests. UI owns local icon rendering. Do not execute uploaded code or infer performance from a product name.
- Rules: implement deterministic evaluations in `rule-engine`, with evidence, recommendations, applicable/unknown outcomes and independent tests. Use the rule proposal issue form to discuss prerequisites.
- Capacity: extend registered behavior in `capacity-engine`, with explicit units, provenance, numerical references and calibration limitations. Never invent vendor or hardware throughput.
- Engineering workflows: keep requirements, decisions and scenario contracts in schema/model; worker orchestration and browser adapters belong in canvas.
- Core: preserve dependency direction and public schema compatibility. Read the relevant ADRs.

Run `pnpm verify`. Editor changes also require `pnpm test:e2e` and keyboard testing. Add a changeset for a public package behavior change. Do not weaken assertions to pass tests. Schema changes require a new version, explicit migration, old-file fixtures, and documentation.

Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Never report vulnerabilities in public issues; consult [SECURITY.md](SECURITY.md).
