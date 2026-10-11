# graph-engine

`validateDocument` combines schema parsing/migration with `graphIssues`. It checks duplicate IDs, references, compatible directional ports, component versions, configuration, containment cycles, engineering references and burst overlap. `compatibleRelationships` exposes endpoint compatibility for pointer and keyboard connections. Structural integrity is separate from `rule-engine` policy findings.
