# SwiftBuild security

SwiftBuild has not completed an independent production security review. The current web application has no accounts, server project database or server authorization. Self-hosting does not supply those controls.

## Private reporting

Do not post vulnerabilities, secrets or private architecture documents in public issues. Maintainers must configure and verify a private vulnerability-reporting channel on the repository host before accepting sensitive reports. No verified contact is recorded here; do not invent an address or assume a reporting feature is enabled. Until a verified private channel exists, do not send sensitive reports through public channels.

Only the latest development revision receives fixes. Through the verified private channel, include the affected revision, reproduction steps, impact and a minimal non-sensitive sample.

## Current safeguards and limitations

Architecture imports and local component packs are limited to 5 MiB; project archives are limited to 50 MiB. Measurement CSV imports are limited to 5 MiB. Inputs are validated before replacement, and invalid imports preserve current work. These are application input limits, not a promise of available browser storage. See [native format](docs/architecture/native-format.md) and [measurement evidence](docs/engineering/measurements.md).

Component definitions and packs are declarative data. Uploaded scripts are not executed; packs cannot install remote icons. Text is rendered as text. These safeguards do not certify untrusted files as safe or supply an extension sandbox for executable code.

Browser drafts are not encrypted by SwiftBuild and must not contain credentials. Workspace transactions and optimistic revisions protect against partial saves and stale-tab overwrites; they do not provide identity, access control or backups. Export archives to preserve work outside browser storage. No product analytics or remote telemetry is enabled by default.

## Planned security work

The [roadmap](docs/roadmap.md) requires trusted-boundary validation, authentication, server-enforced authorization, workspace isolation, audit events, secure sessions, migration and recovery tests, dependency review and operational verification before shared server workflows are described as available. Current checks and unverified areas are listed in [current status](docs/status.md).
