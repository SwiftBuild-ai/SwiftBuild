# architecture-schema

Zod contracts and TypeScript types for native document version 1.1, including scenarios, traffic classes, provenance, distributions, performance profiles, flow policies, targets and assessments. `migrateDocument` explicitly migrates 1.0 without mutating input; parsing/import paths invoke migration at boundaries. Unsupported versions are rejected. Component schema versions remain independent. Serialization preserves JSON-safe metadata. No React or hosting dependencies.
