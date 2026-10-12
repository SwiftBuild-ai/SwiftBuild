# SwiftBuild security

SwiftBuild has not completed an independent production security review. Browser-local mode has no account requirement or shared server project storage. Optional server mode implements invite-only accounts, verified sessions, workspace roles, authorized project access and transactional immutable revisions. The default compose configuration remains browser-local. See [server setup](docs/self-hosting/README.md) and [current verification](docs/status.md) for configuration and tested boundaries.

## Private reporting

Do not post vulnerabilities, secrets or private architecture documents in public issues. Maintainers must configure and verify a private vulnerability-reporting channel on the repository host before accepting sensitive reports. No verified contact is recorded here; do not invent an address or assume a reporting feature is enabled. Until a verified private channel exists, do not send sensitive reports through public channels.

Only the latest development revision receives fixes. Through the verified private channel, include the affected revision, reproduction steps, impact and a minimal non-sensitive sample.

## Current safeguards and limitations

Architecture imports and local component packs are limited to 5 MiB; project archives are limited to 50 MiB. Measurement CSV imports are limited to 5 MiB. Inputs are validated before replacement, and invalid imports preserve current work. These are application input limits, not a promise of available browser storage. See [native format](docs/architecture/native-format.md) and [measurement evidence](docs/engineering/measurements.md).

Component definitions and packs are declarative data. Uploaded scripts are not executed; packs cannot install remote icons. Text is rendered as text. These safeguards do not certify untrusted files as safe or supply an extension sandbox for executable code.

Browser drafts are not encrypted by SwiftBuild and must not contain credentials. Workspace transactions and optimistic revisions protect against partial saves and stale-tab overwrites; they do not provide identity, access control or backups. Export archives to preserve work outside browser storage. No product analytics or remote telemetry is enabled by default.

Server access derives actors from verified sessions and checks active admission and workspace membership inside project transactions. Mutations validate input and expected revisions; uncertain saves retain operation IDs and separate local recovery. Password and optional organizational sign-in use configured identity settings. Operator-issued invitation and password recovery links are one-time secrets and must be delivered privately; no mail server is required. These controls do not establish production readiness or certify a deployed identity provider.

Local server-project recovery is not encrypted or protected by account isolation on a shared browser profile. Sign-out retains it; confirmed-copy cleanup preserves unsaved work. Export recovery before clearing site data. Use HTTPS beyond explicit loopback development, keep secrets outside source control, apply trusted migrations explicitly and separate runtime access from schema ownership.

## Planned security work

The [roadmap](docs/roadmap.md) retains operational deployment, automated least-privilege role provisioning, tested backup/restore, bootstrap-link rotation and complete recovery workflows as unfinished work. Team review and concurrent collaboration remain planned. Independent security review, deployed organizational sign-in and verified private reporting contacts remain unverified. Existing identity, authorization and migration tests establish only their documented tested workflows; see [current status](docs/status.md).
