# 0008 — Invite-only identity and optional mail

Status: accepted.

Decision: support local password accounts and configured organizational OIDC with a maintained authentication library, database-backed sessions, hashed expiring invitation tokens and server admission checks. Core architecture packages remain independent of identity. Server actors must come from verified active sessions; membership authorization remains a separate per-operation check.

Bootstrap is a local operator command, not a public first-user claim. Operators issue single-use invitation and password-recovery links for private delivery. A mail server is not a prerequisite. OIDC is optional deployment configuration, but its protocol path is implemented and tested alongside local accounts. Its identities require verified email claims and configured issuer/token verification. Automatic same-email account linking is disabled; linking requires authenticated intent.

Require HTTPS and an exact trusted origin; allow HTTP only through explicit loopback development configuration. Apply bounded input and database-backed rate limits. Recheck active admission after reading a session. Authentication can create a pending account before admission completes; such an account has no project access. A valid invitation plus credential sign-in can resume local admission after an interruption. Invitation consumption, workspace membership and audit insertion are transactional. Password recovery revokes existing sessions and cannot reactivate a disabled account.

Consequences: operator access and private link delivery are required for an instance without mail. Secrets and one-time links must never enter commits or routine logs. The web host must expose only the permitted authentication endpoints and authorize every project request. Protocol fixture tests do not establish deployment-provider compatibility or independent security certification. Authentication services alone do not complete the server project workflow.
