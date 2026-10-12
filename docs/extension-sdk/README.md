# Declarative components

Current primitives live in `packages/components-core`; infrastructure technologies, taxonomy and validated local component packs live in `packages/component-registry`. Both use ComponentDefinitionSchema. A standalone SDK and remote registry distribution remain later milestones.

A definition includes ID, semantic version, schema version, category, capabilities, primitive configuration fields with defaults and bounds, directional ports accepting relationship kinds, constraints, documentation, icon identifier, and tags. Add unit fixtures for valid defaults and compatible ports. Icons are presentation identifiers; capabilities and connections carry meaning.

User imports may embed definitions, but cannot execute code. Versioned `swiftbuild-component-pack` JSON files can install declarative community definitions without editor changes. Unknown icon IDs use a local fallback; custom SVG installation and executable extensions are not supported. See the [registry contract](../../packages/component-registry/README.md).

A minimal validated pack is available at [`examples/audit-service-pack.swiftbuild-component-pack.json`](../../examples/audit-service-pack.swiftbuild-component-pack.json). Import it with the canvas "Import component pack" control or pass the parsed JSON to `loadPack`. The example is synthetic: it declares defaults, compatible directional ports and resource assumptions, but supplies no measured throughput and no new runtime behavior.

Custom components can select an existing declared capacity behavior: service, database, cache, queue or router. The current registry lives in `capacity-engine`; profiles require evidence provenance and explicit resource assumptions. Unsupported behavior remains unknown. Add behavior contracts and numerical references before extending the engine; do not infer performance from icon, vendor name or configuration labels.
