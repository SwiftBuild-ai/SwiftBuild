# SwiftBuild current status

Implementation inventory updated October 12, 2026. Server API foundation is merged at `8603007`; account screens were verified at `5bb1942`. The earlier October 11 documentation baseline at `20dc9ee` is retained below. This page distinguishes source-backed capabilities from dated execution results and does not certify production readiness.

## Capability inventory

| Area                 | Current implementation                                                                                              | Boundary                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Architecture model   | Native 1.1, explicit 1.0 migration, stable IDs, embedded definitions and separate layout                            | Future incompatible formats require explicit migration                                                                 |
| Editor               | Searchable catalog, typed connections, grouping, object list, configuration, undo/redo, locking, minimap and themes | No claim that every advanced editing operation in the target vision is complete                                        |
| Registry             | 61 cataloged definitions plus eight retained primitives; validated declarative local packs                          | No remote distribution, standalone SDK or uploaded executable extensions                                               |
| Engineering records  | Linked requirements, decisions, scenarios, profiles, evidence and assessments                                       | No team review, deployment drift service or automated operational observation                                          |
| Validation           | Structural checks and deterministic policy outcomes with evidence and unknown states                                | Declared checks do not establish security or availability guarantees                                                   |
| Capacity             | Workload estimation, analytical propagation and seeded bounded topology simulation                                  | Limited to registered behavior, declared evidence and supported operating ranges                                       |
| Persistence          | Browser workspaces plus optional transactional server project APIs, immutable revisions, retry IDs and audit events | Browser editor remains local; server editor/promotion and operational recovery remain planned                          |
| Accounts             | Invite-only password accounts, configured organizational OIDC, sessions, roles, invitation/recovery screens         | Operator-issued links need no mail server; deployed organizational provider and independent security review unverified |
| Self-hosting         | Standalone web image, non-root runtime, optional configured API host and separate health/readiness                  | Default compose remains browser-local; full server deployment and backup/restore remain planned                        |
| Architecture-as-code | Native JSON import/export and pure domain engines                                                                   | YAML, standalone CLI and architecture CI commands are planned                                                          |

[Engineering documentation](engineering/README.md) describes supported calculations and limitations. The [roadmap](roadmap.md) preserves the full target platform, including a real backend and collaboration.

## Verification on October 11, 2026

The planning baseline ran formatting, lint/dependency boundaries, type checks and all 70 unit tests across 19 files successfully. Production build failed with `EBUSY` while replacing a locked standalone output directory; an existing production server was using that directory. This is a failed build run, not a successful full `pnpm verify`.

The documentation refresh reran `pnpm verify`: formatting, lint/dependency boundaries, type checks and all 70 unit tests passed again; the production build failed again with the same locked-directory error. A separate documentation check reviewed 41 Markdown files and 66 links, checked documented root scripts and manifest prerequisites, and found no missing local link targets, external documentation reference links or disallowed prose brands. Required legal notices and historical release notes were excluded from the prose policy check.

Later on October 11, the output lock was no longer present: a fresh production build succeeded and the full local `pnpm verify` completed successfully with all 70 unit tests. The running production workbench was inspected without changing its architecture. The package and contributor documentation pull requests also passed hosted verification and container smoke checks before merging. These later results supersede the earlier build blockage; they do not erase its recorded failures.

No full local browser suite, accessibility certification or backup recovery result was established by this refresh. In-app help was inspected and left unchanged. No runtime, schema or dependency changes were made. Existing screenshots illustrate the product; historical local QA notes and configured CI checks are not fresh verification. Independent production security review and private reporting channel verification remain unestablished.

For new verification results, record the revision, command, environment, outcome and any limitations. Follow [development](../DEVELOPMENT.md); stop the relevant standalone server before rebuilding on a host where its output is locked. Do not delete stored browser work to resolve a build issue.

## Server foundation verification on October 12, 2026

Local `pnpm verify` passed formatting, lint/dependency boundaries, types, 73 unit tests and 21 real database integration tests, followed by a successful production build. The database tests use isolated schemas in a disposable `_test` database and exercise migration rollback/checksums, competing writes, authorization, immutable revisions, retry behavior, real password identity, signed local OIDC protocol fixtures and bounded HTTP input. Server foundation PRs passed hosted verification and container smoke checks before merge.

A compiled production HTTP workflow authenticated, created and saved an archive, stopped and restarted the web process, and reopened revision 2 with history intact. An unauthenticated read was rejected. Account browser checks exercised invitation signup, invalid credentials, password sign-in, sign-out invalidation, additional invitation acceptance and password recovery revoking the old session. Fresh desktop dark and mobile light captures were inspected, with keyboard focus and horizontal overflow checks. The 22 browser regressions passed across the full run and a focused rerun after an ambiguous error selector was scoped to the page.

These checks establish the tested local workflows. They do not establish deployed organizational sign-in, full accessibility certification, production backup restoration, runtime database-role provisioning, independent security review or a verified private reporting contact. Project-list/editor integration and the remaining milestone 1 operational gates are unfinished.

## Documentation policy

SwiftBuild is the only brand in maintained prose and commit messages. Exact executable commands, file paths, dependency/API identifiers and required third-party attribution are exceptions. Technology identities remain intact in the implementation and serialized documents. Maintained guides use internal links; source research and temporary audit evidence stay in ignored local directories. Historical release notes and original legal notices retain their original text.
