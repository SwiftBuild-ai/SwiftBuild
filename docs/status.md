# SwiftBuild current status

Implementation inventory updated October 13, 2026. Durable creation recovery, immutable restoration and bootstrap rotation are recorded in the foundation verification entries below. Server editor implementation was verified at `4992e59`, with database-backed browser verification at `7a617bc`. The server API foundation at `8603007`, account delivery and earlier October 11 documentation baseline at `20dc9ee` remain recorded below. This page distinguishes source-backed capabilities from dated execution results and does not certify production readiness.

## Capability inventory

| Area                 | Current implementation                                                                                                 | Boundary                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Architecture model   | Native 1.1, explicit 1.0 migration, stable IDs, embedded definitions and separate layout                               | Future incompatible formats require explicit migration                                                                 |
| Editor               | Searchable catalog, typed connections, grouping, object list, configuration, undo/redo, locking, minimap and themes    | No claim that every advanced editing operation in the target vision is complete                                        |
| Registry             | 61 cataloged definitions plus eight retained primitives; validated declarative local packs                             | No remote distribution, standalone SDK or uploaded executable extensions                                               |
| Engineering records  | Linked requirements, decisions, scenarios, profiles, evidence and assessments                                          | No team review, deployment drift service or automated operational observation                                          |
| Validation           | Structural checks and deterministic policy outcomes with evidence and unknown states                                   | Declared checks do not establish security or availability guarantees                                                   |
| Capacity             | Workload estimation, analytical propagation and seeded bounded topology simulation                                     | Limited to registered behavior, declared evidence and supported operating ranges                                       |
| Persistence          | Independent browser drafts, authorized server editing, transactional revisions, retry operations and separate recovery | Durable creation recovery and immutable restoration implemented; production backup/restore validation remains open     |
| Accounts             | Invite-only password accounts, configured organizational OIDC, sessions, roles, invitation/recovery screens            | Operator-issued links need no mail server; deployed organizational provider and independent security review unverified |
| Self-hosting         | Standalone web image, non-root runtime, optional configured API host and separate health/readiness                     | Default Compose remains browser-local; optional full-server deployment and isolated backup/restore are verified below  |
| Architecture-as-code | Native JSON import/export and pure domain engines                                                                      | YAML, standalone CLI and architecture CI commands are planned                                                          |

[Engineering documentation](engineering/README.md) describes supported calculations and limitations. The [roadmap](roadmap.md) preserves the full target platform, including a real backend and collaboration.

## Verification on October 11, 2026

The planning baseline ran formatting, lint/dependency boundaries, type checks and all 70 unit tests across 19 files successfully. Production build failed with `EBUSY` while replacing a locked standalone output directory; an existing production server was using that directory. This is a failed build run, not a successful full `pnpm verify`.

The documentation refresh reran `pnpm verify`: formatting, lint/dependency boundaries, type checks and all 70 unit tests passed again; the production build failed again with the same locked-directory error. A separate documentation check reviewed 41 Markdown files and 66 links, checked documented root scripts and manifest prerequisites, and found no missing local link targets, external documentation reference links or disallowed prose brands. Required legal notices and historical release notes were excluded from the prose policy check.

Later on October 11, the output lock was no longer present: a fresh production build succeeded and the full local `pnpm verify` completed successfully with all 70 unit tests. The running production workbench was inspected without changing its architecture. The package and contributor documentation pull requests also passed hosted verification and container smoke checks before merging. These later results supersede the earlier build blockage; they do not erase its recorded failures.

No full local browser suite, accessibility certification or backup recovery result was established by this refresh. In-app help was inspected and left unchanged. No runtime, schema or dependency changes were made. Existing screenshots illustrate the product; historical local QA notes and configured CI checks are not fresh verification. Independent production security review and private reporting channel verification remain unestablished.

For new verification results, record the revision, command, environment, outcome and any limitations. Follow [development](../DEVELOPMENT.md); stop the relevant standalone server before rebuilding on a host where its output is locked. Do not delete stored browser work to resolve a build issue.

## Historical server foundation verification on October 12, 2026

Local `pnpm verify` passed formatting, lint/dependency boundaries, types, 73 unit tests and 21 real database integration tests, followed by a successful production build. The database tests use isolated schemas in a disposable `_test` database and exercise migration rollback/checksums, competing writes, authorization, immutable revisions, retry behavior, real password identity, signed local OIDC protocol fixtures and bounded HTTP input. Server foundation PRs passed hosted verification and container smoke checks before merge.

A compiled production HTTP workflow authenticated, created and saved an archive, stopped and restarted the web process, and reopened revision 2 with history intact. An unauthenticated read was rejected. Account browser checks exercised invitation signup, invalid credentials, password sign-in, sign-out invalidation, additional invitation acceptance and password recovery revoking the old session. Fresh desktop dark and mobile light captures were inspected, with keyboard focus and horizontal overflow checks. The 22 browser regressions passed across the full run and a focused rerun after an ambiguous error selector was scoped to the page.

These checks establish the tested local workflows. They do not establish deployed organizational sign-in, full accessibility certification, production backup restoration, runtime database-role provisioning, independent security review or a verified private reporting contact. Project-list/editor integration and the remaining milestone 1 operational gates are unfinished.

## Server editor verification on October 12, 2026

Hosted verification executed all 107 tests, including real database suites, followed by a successful production build, 22 browser-local regressions and three dedicated server browser tests. The dedicated fixture creates an isolated schema in a `_test` database, generates its own identity secret, applies trusted migrations and removes the schema at teardown. It checks disabled credential fields without JavaScript, server create/edit/save/reload, immutable history export, keyboard history dismissal, a single primary editor landmark, stale-write preservation, recovery as a separate project, complete checkpoint promotion without local replacement, offline recovery and viewer previews with direct server writes rejected.

Fresh server editor, recovery and narrow project-list captures were inspected. Both hosted verification and container smoke checks passed. Transport unit tests separately cover uncertain response replay, native fetch binding, recovery storage failure and selective cache cleanup; these are not live production-network fault certification.

Local formatting, lint/dependency boundaries, types, 86 unit tests and production build passed. The 21 local database tests were explicitly skipped after the local container runtime failed startup on a locked service socket. Hosted database and browser results establish the isolated tested workflows independently of that local environment failure. The earlier failures and successful runs remain recorded above.

Server editing, saved-draft promotion and explicit browser recovery are implemented. Default compose is still browser-local. Full deployment, runtime role provisioning, backup/restore, creation retry recovery across reload and complete revision-restoration UI remain unfinished. Deployed organizational sign-in, private reporting contacts, independent security review and full accessibility certification remain unverified.

## Engineering computation verification on October 13, 2026

The focused integration adds separate analysis contracts, generated JSON Schema/Pydantic types, canonical cross-language fixtures, durable TypeScript jobs, isolated Python reliability and numerical sensitivity, existing-engine capacity sweeps, and a host-injected engineering workbench. Native format 1.1, archive format 1.0, TypeScript engine behavior, authentication and browser-local editing remain intact. The open-source product uses manual design without AI adoption.

Local verification passed formatting, lint/package boundaries, type checks, 119 TypeScript tests across 24 files (including every real isolated-database test and the complete dispatcher/Python process integration), and the production build. Fourteen Python tests passed, including numerical references, shared/repeated failures, deterministic sampling, schema/canonical fixtures, real child execution, cancellation, deadlines, memory-failure classification, malformed-response redaction and integer/float wire compatibility. Schema and generated-model drift checks passed. Twenty-two browser-local tests passed; all four separate server browser tests passed with a real Python service/dispatcher, including reload and historical bundle export/import. Dark and narrow analysis captures were inspected.

The optional full-server Compose smoke passed with one-CPU/512 MiB computation limits, bounded process counts, explicit migrations and a separate runtime database role. It exercised authenticated HTTP submission, the isolated Python child, durable reports, analysis bundles, database dump/restore into an isolated test database, restored admission/session authorization, and numerical replay. The test deployment and restore database were removed afterward. Docker was reachable through the local Linux environment; its Windows endpoint remained unavailable. Initial health-check failures from excessive Node threads were corrected with direct startup and bounded thread pools. An earlier concurrent browser run collided on artifact cleanup; the suites passed when run sequentially.

At this integration stage, milestones 1 and 6 remained open. Subsequent foundation entries below implement project-creation retry recovery, revision restoration and bootstrap-link rotation; outage timelines, richer calibration and other roadmap gates remain unfinished. Worker topology currently uses one dispatcher/computation pair; retention policy, production recovery certification, independent security review and full accessibility certification remain unverified. See [models](engineering/analysis.md), [deployment](self-hosting/computation.md) and [ADR 0009](adr/0009-engineering-computation-service.md).

## Documentation policy

SwiftBuild is the only brand in maintained prose and commit messages. Exact executable commands, file paths, dependency/API identifiers and required third-party attribution are exceptions. Technology identities remain intact in the implementation and serialized documents. Maintained guides use internal links; source research and temporary audit evidence stay in ignored local directories. Historical release notes and original legal notices retain their original text.

### 2026-10-13 — durable project creation recovery

Creation intents now survive reload for all server creation/copy paths. Transactional insertion rejects competing intents and scoped recovery preserves uncertain responses. Focused recovery tests cover reload, payload replay, competing tabs, account isolation, denial, malformed confirmation and storage failure. The server browser workflow commits a creation, drops its response, reloads and retries the same operation to the original project.

### 2026-10-13 — immutable revision restoration

A distinct authenticated restoration endpoint appends complete attributed archives with source/base metadata and idempotent retries. Existing migration fixtures preserve archive bodies and digests. Transactional tests cover immutable history, identical content, competing writes, permissions, revocation, operation reuse and audit rollback. Browser coverage exercises preview, keyboard confirmation, narrow layouts, lost-response reload/retry and intervening-writer preservation. Deployment recovery replays the original creation and restoration operations after database restore.

### 2026-10-13 — operator bootstrap-link rotation

The operator CLI can replace a lost or expired bootstrap invitation before admission. Concurrent rotation and admission use the same lock order; every unused old link is revoked in the issuing transaction. Real database tests exercise repeated/concurrent rotation, expired/revoked links, admission races, post-enrollment refusal and private CLI delivery. No user-facing token issuance endpoint was added.

## Foundation verification on October 13, 2026

Implemented code through `728cef9` preserves the existing TypeScript semantic, validation and simulation engines and private Python computation boundary. Creation recovery, immutable restoration and bootstrap rotation were committed as separate verified slices. The final run of `pnpm verify` passed formatting, lint/boundaries, types, all 134 tests across 25 files (including real isolated-database suites with no skips), and the production build.

Python verification passed 14 tests and both generated-schema/model drift checks. Browser-local verification passed all 22 local tests; its five server-only tests are intentionally run separately. The dedicated server suite passed all five tests, including committed creation response loss/reload/retry, revoked-workspace recovery/export, immutable restoration preview and keyboard confirmation, narrow layouts, restore response loss/reload/retry, intervening-writer preservation and the existing computation workflow. Fresh restoration captures were inspected and a narrow history layout defect was corrected.

Default browser-local Docker startup and HTTP smoke passed. The optional full-server Docker deployment passed health/readiness, private computation execution, bundle export, database dump/restore, restored authorization, original creation/restoration operation replay without extra revisions, and numerical replay. Disposable deployments and test schemas are cleaned afterward. These checks demonstrate isolated local recovery; production retention, recovery objectives, deployed organizational sign-in, independent security review and full accessibility certification remain separate open gates. Milestones 1 and 6 remain in progress; the rest of the roadmap retains its dependency order.

## Operator recovery tooling on October 13, 2026

All previously verified work through `faa2500` was pushed to `origin/feat/engineering-computation`. The next foundation slice adds private `backup`, `verify-backup` and `recovery-drill` commands, shared-snapshot dump manifests, streaming integrity checks, isolated target guards and restored runtime-role checks. The deployment smoke invokes the actual CLI and performs restored application/numerical replay with the runtime connection. See [operator instructions](self-hosting/recovery.md) and [ADR 0011](adr/0011-operator-recovery-drills.md).

Local verification passed 101 non-database TypeScript tests (including five new recovery boundary tests), formatting, lint/boundaries, types, production build, 14 Python tests and generated-contract/model drift checks. These checks exclude the 38 real database integration tests and do not establish recovery integration. Docker Desktop's engine was unavailable, its graceful restart failed, and the operator explicitly requested keeping Docker stopped. Real database tests, the modified full-stack recovery smoke and current container verification remain pending. This slice does not complete milestone 1 or production recovery acceptance.
