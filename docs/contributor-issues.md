# SwiftBuild contributor issues

Issues describe actionable work; the [roadmap](roadmap.md) preserves the full product vision. Search existing issues and PRs before opening a new task. A planned capability is a feature gap, not automatically a defect. Never report vulnerabilities, credentials, invitation links or private architecture data in public issues; follow [security reporting](../SECURITY.md).

## Difficulty and scope

| Label                | Suitable work                                                                                                   | Required preparation                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `good first issue`   | A small documentation, example or regression-test task with clear entry points and existing patterns            | Identify the files, expected result and commands; avoid requiring identity, migration or consistency design |
| `difficulty: medium` | A bounded change involving multiple modules, a parser, persistence, concurrency or operational failure handling | State prerequisites, preserved contracts, negative cases and a realistic verification environment           |

Use one difficulty label per issue. Add `bug` only for a reproduced defect; use `enhancement` for missing capabilities or checks, `documentation` for guidance and `accessibility` for accessibility work. Difficulty is separate from priority and is not a delivery estimate. Reassess labels when scope changes. Large milestones need smaller prerequisite issues before they are suitable contributor tasks.

## What an actionable issue includes

- **Problem and outcome:** the current behavior and concrete improvement for users or contributors.
- **Evidence:** reviewed commit, source paths and tests, with synthetic reproduction steps for a defect. State whether evidence comes from source inspection, a command or a fresh browser run.
- **Scope and prerequisites:** package ownership, dependencies and excluded follow-on work. Link prerequisite issues when available.
- **Completion criteria:** observable results, preserved IDs/formats/contracts, invalid-input and failure behavior where relevant.
- **Verification:** focused commands and fixtures, plus the repository checks required by [development](../DEVELOPMENT.md). Database work needs an isolated `_test` database. Skipped, failed and unavailable checks must be explicit.

Do not call an issue complete merely because a control or stub exists. The workflow, persistence, permissions, tests and documentation must agree. Preserve native format 1.1, explicit 1.0 migration and archive format 1.0 unless the task explicitly includes a new version and migration.

## Contributor delivery

Read [contributing](../CONTRIBUTING.md), [agent guidance](../AGENT.md), package documentation and the relevant accepted decisions. Discuss the approach on the issue, keep the branch focused and commit each coherent improvement separately. Reference the issue in the PR, include meaningful verification and update affected documentation. Both hosted verification jobs must pass for the current head before merge. Retarget dependent PRs before deleting a parent branch.

Public audit evidence must stay minimal and non-sensitive. Detailed local research, scratch reproduction scripts and generated captures belong in ignored directories. Source inspection and successful tests do not establish exhaustive correctness, accessibility certification or production readiness.
