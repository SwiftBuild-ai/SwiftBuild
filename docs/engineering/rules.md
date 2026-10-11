# Deterministic rule evaluation

`evaluateArchitecture(document, context)` returns engine/model versions, the semantic fingerprint, structural issues, findings, rule outcomes and requirement assessments. Rules cannot mutate the document. UI corrections use validated undoable model commands.

Outcomes distinguish passed, failed, not applicable and insufficient information. Findings provide severity, affected objects, reasons, recommendations, evidence and in-app documentation links.

Production redundancy and health checks apply only to explicitly designated production nodes. Backup policy uses explicit durable-storage configuration. Replica count alone cannot establish independent failure domains or failover. Queue dead-letter checks use explicit configuration. Trust checks flag public storage paths and declared trust-boundary crossings without inventing security guarantees.

Capacity coverage, overload, backlog growth, storage exhaustion and target violations require matching engine output. Imported, stale, unsupported-version and incomplete results cannot establish successful performance assessments. Deadline assessment also accounts for censored and unsuccessful requests. Combined node-and-traffic-class targets currently remain unknown when that exact aggregation is unavailable.

Add a rule with deterministic prerequisites, useful evidence, an actionable recommendation, not-applicable/unknown behavior and independent tests. Keep rule logic out of presentation components and never execute uploaded rule code. The in-app `/guide` route explains built-in rules without requiring an external repository URL.
