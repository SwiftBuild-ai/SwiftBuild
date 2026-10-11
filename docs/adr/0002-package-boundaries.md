# 0002 — Framework-independent core

Status: accepted.

Context: CLI, self-hosted web, and future hosted services must share architecture logic.

Decision: isolate schema, model, graph validation, and declarative components from the UI framework and persistence. Inject storage at the editor boundary. Enforce downward imports in lint.

Alternatives: application-owned model; backend-first shared ORM types.

Consequences: extra adapter code, but no hosting dependency in the useful open-source core.

Migration considerations: future API persistence and database migrations must not redefine domain contracts.
