# Declarative components

The standalone extension SDK is a later milestone. Current definitions live in `packages/components-core` and are validated with ComponentDefinitionSchema.

A definition includes ID, semantic version, schema version, category, capabilities, primitive configuration fields with defaults and bounds, directional ports accepting relationship kinds, constraints, documentation, icon identifier, and tags. Add unit fixtures for valid defaults and compatible ports. Icons are presentation identifiers; capabilities and connections carry meaning.

User imports may embed definitions, but cannot execute code. A future package format will include component.json, schema.json, icon.svg, README.md and examples.
