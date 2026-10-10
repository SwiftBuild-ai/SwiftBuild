# Contributing

Install the prerequisites in [DEVELOPMENT.md](DEVELOPMENT.md), fork and clone the repository when a remote is available, then run `pnpm install` and `pnpm dev`.

Use a focused `feat/`, `fix/`, `docs/`, `refactor/`, or `chore/` branch. Use Conventional Commits and keep changes coherent. Submit the PR template with motivation, verification, and screenshots for UI changes. Normal PRs use squash merge.

## Contribution paths

- Documentation: improve onboarding and architecture explanations.
- Templates: propose a schema-valid JSON example under `examples/` with a clear purpose.
- Components: add a declarative definition in `components-core`, validated defaults, ports, documentation, and tests. Do not execute uploaded code.
- Rules: use the rule proposal issue form. The rule engine is a later milestone; describe deterministic inputs, findings, and test cases before adding packages.
- Core: preserve dependency direction and public schema compatibility. Read the relevant ADRs.

Run `pnpm verify`. Editor changes also require `pnpm test:e2e` and keyboard testing. Add a changeset for a public package behavior change. Do not weaken assertions to pass tests. Schema changes require a new version, explicit migration, old-file fixtures, and documentation.

Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Never report vulnerabilities in public issues; consult [SECURITY.md](SECURITY.md).
