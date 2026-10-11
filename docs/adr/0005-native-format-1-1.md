# 0005 — Native format 1.1

Status: accepted.

Decision: add typed engineering contracts under native document version 1.1 and explicitly migrate 1.0. Document versions and embedded component versions remain independent. Reject unsupported versions without changing input; preserve IDs and JSON-safe metadata.

Consequences: older documents gain default empty engineering collections and validated settings. Existing component definitions are not silently upgraded. Reference validation and deletion/duplication behavior include the engineering entities. Migration fixtures remain permanent compatibility tests.
