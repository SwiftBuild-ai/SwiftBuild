# architecture-model

Immutable document commands and bounded history. editDocument, moveNode, deleteNodes and duplicateNodes operate on the native document. semanticSnapshot excludes views and orders object keys deterministically. commit, undo and redo share the same document history for semantic and layout edits.

Engineering references are cleaned when nodes/edges are removed and copied when related nodes/edges are duplicated. `inputFingerprint` canonicalizes ID collections and excludes layout and generated state. `createCheckpoint`, `compareCheckpoints` and `restoreCheckpoint` provide immutable snapshots, semantic/layout comparison and recovery-before-restore. Checkpoint storage remains an adapter responsibility.
