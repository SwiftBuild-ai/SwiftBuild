# Contributing

First contributions are welcome. Small documentation fixes and focused Python improvements are useful contributions; you do not need to understand the whole architecture to get started. Questions and draft PRs are welcome, including when setup or a check is giving you trouble.

## Start small

1. Choose a `good first issue` or a small improvement you can explain. Check existing issues and PRs to avoid duplicate work. You can start a small fix without permission or a separate proposal; discuss larger changes before investing substantial work.
2. Fork and clone the repository, then create a focused `feat/`, `fix/`, `docs/`, `refactor/`, or `chore/` branch. Read the issue's linked files and the relevant package guidance. You only need architecture decisions that affect your change.
3. Make the change and run the focused checks below. Keep the PR about one task; a single coherent commit is fine. Use a Conventional Commit subject such as `docs: clarify Python setup`.
4. Open a PR with what changed, why, and the checks you ran. Mention `Fixes #NUMBER` when it completes an issue. Leave irrelevant template sections out and describe any checks you could not run. Maintainers can help with the remaining verification.

Documentation edits do not require running the application. Python-only work can use the setup in [the backend guide](services/backend/README.md) without installing Node or starting the web app. For web development, install the prerequisites in [DEVELOPMENT.md](DEVELOPMENT.md), then run `pnpm install` and `pnpm dev`.

## Checks for your change

| Change                   | Checks before requesting review                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Documentation only       | Review links, commands and claims against the referenced source. If Node is available, run `pnpm docs:check` and `pnpm exec prettier --check PATH_TO_CHANGED_FILE`. Otherwise mention that in your PR.                                           |
| Python backend           | Run the relevant tests from `services/backend` with `python -m pytest tests/RELEVANT_TEST_FILE.py -q`, plus `python -m ruff check PATH` and `python -m ruff format --check PATH` for changed Python files. Use the virtual environment's Python. |
| Web or shared TypeScript | Run the affected package's checks; see [development commands](DEVELOPMENT.md). Editor interactions also need the relevant browser tests and keyboard checks.                                                                                     |

You do not need Docker, PostgreSQL, or the full repository suite to submit a docs fix or a Python task that does not use the database. Database tests require an isolated `_test` database; a skipped test is not a pass. Report failed or unavailable checks honestly and ask for help rather than weakening assertions. Add meaningful tests when behavior changes; prose-only changes do not need new tests, screenshots, an ADR, or a changeset.

The full checks still protect merging: maintainers ensure both hosted `verify` and `docker-smoke` pass for the current head. Contributors do not need to reproduce every CI job locally before opening a PR. Maintainers use a regular merge commit to preserve individual commits; squash or rebase only when explicitly requested, and retarget dependent PRs before deleting a parent branch.

## Contribution paths

- Documentation: verify claims against source and tests; distinguish implemented, limited and planned behavior. Use SwiftBuild as the only brand in prose and commit messages. Preserve exact commands, dependency/API identifiers and required attribution. Use internal links; keep external research in ignored local notes.
- Templates: propose a schema-valid JSON example under `examples/` with a clear purpose.
- Components: keep vendor-neutral primitives in `components-core`; add technologies, taxonomy and validated local packs in `component-registry`, with defaults, ports, documentation, and tests. UI owns local icon rendering. Do not execute uploaded code or infer performance from a product name.
- Rules: implement deterministic evaluations in `rule-engine`, with evidence, recommendations, applicable/unknown outcomes and independent tests. Use the rule proposal issue form to discuss prerequisites.
- Capacity: extend registered behavior in `capacity-engine`, with explicit units, provenance, numerical references and calibration limitations. Never invent vendor or hardware throughput.
- Engineering workflows: keep requirements, decisions and scenario contracts in schema/model; worker orchestration and browser adapters belong in canvas.
- Core: preserve dependency direction and public schema compatibility. Read the relevant ADRs.

For public package behavior changes, add a changeset. Schema changes require a new version, explicit migration, old-file fixtures, and documentation. Significant architecture changes need an ADR. These requirements apply when your change affects those areas, not to every contribution. See [issue guidance](docs/contributor-issues.md) for scoping larger tasks.

Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Never report vulnerabilities in public issues; consult [SECURITY.md](SECURITY.md).
