# 0004 — Browser workspaces and checkpoints

Status: accepted.

Decision: use an injected asynchronous IndexedDB adapter to atomically persist the current architecture, immutable named checkpoints and run summaries. Retain the legacy localStorage value after validated migration. Use optimistic revisions to reject stale tab writes.

Checkpoint bodies remain outside the current document. Restoration creates a recovery checkpoint and an undoable edit. Native JSON is architecture-only; a separately versioned project archive preserves checkpoint bodies and evidence.

Consequences: persistence failures leave in-memory work exportable. Quota failures never silently prune checkpoints. Browser data remains origin-specific and can be cleared externally; archives are the portable backup. Future server adapters must preserve these domain contracts and introduce explicit authorization.
