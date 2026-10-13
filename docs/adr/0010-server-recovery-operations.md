# ADR 0010: Durable creation intents and immutable restoration

Status: accepted

## Decision

The web host persists creation intents in a separate, actor/workspace-scoped IndexedDB store before network submission. Atomic insertion permits one unresolved intent per scope. Retries retain the original operation and payload; only a validated response clears its matching intent. Site storage is a recovery aid, not server authorization or encryption. The session supplies the actor; optional actor preconditions reject account switches in old tabs.

Restoration is a distinct server operation that always appends a revision. A checksum-verified additive migration records operation kind, source revision and expected base on immutable revision rows. These rows serve as durable operation receipts. Exact retries return the same attributed revision, including after later revisions or backup recovery. Conflicting operation reuse is rejected. Existing archives and fingerprints are unchanged.

The server transaction checks active admission and workspace permissions, locks the project and commits archive, pointer and audit together. Browser restore intents retain their original source/base before dispatch and require explicit retry after uncertainty. Restoration is blocked while local edits or saves remain unresolved. Saved analysis jobs keep their original revision identities and never execute as a side effect of restoration.

## Consequences

Creation recovery survives browser reload but requires export before clearing site data. Restoration preserves history rather than moving a revision pointer. New revisions are created even for identical content, so every restoration has an attributable durable receipt. Additive migration rollback uses the matching prior application release with expanded columns retained; do not delete revision metadata or rewrite migration history.

Bootstrap invitation rotation is private operator tooling. It is permitted only between initial issuance and admission, revokes all unused bootstrap links atomically and cannot reset an enrolled instance. Admission and rotation take the same advisory lock before invitation row locks. This serializes races even when preliminary authentication checks happened before rotation. Account credential creation and admission are separate: an interrupted unadmitted account can sign in with the replacement invitation; no revoked link gains admission.
