# SwiftBuild project format

Host-independent validation and serialization for project archive version 1.0. This package owns `ProjectArchiveSchema`, `CapacityReportSchema`, `validateArchive`, `serializeArchive`, `importArchive`, `workspaceFor`, `MAX_ARCHIVE_BYTES` and the asynchronous `WorkspaceAdapter` interface.

Native architecture format remains 1.1 with explicit 1.0 migration at every document/checkpoint boundary. Embedded identities and metadata are retained. Duplicate checkpoint IDs and structurally invalid documents are rejected. Imports mark saved runs historical; plain validation does not change their provenance. Serialized and imported archives are limited to 50 MiB, including actual UTF-8 byte size.

No browser storage, UI framework, account or server dependencies. The canvas retains re-exports for existing consumers and owns its transactional browser adapter. Server storage must use these same contracts and supply authorization independently.
