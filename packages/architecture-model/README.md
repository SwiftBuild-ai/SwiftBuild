# architecture-model

Immutable document commands and bounded history. editDocument, moveNode, deleteNodes and duplicateNodes operate on the native document. semanticSnapshot excludes views and orders object keys deterministically. commit, undo and redo share the same document history for semantic and layout edits.
