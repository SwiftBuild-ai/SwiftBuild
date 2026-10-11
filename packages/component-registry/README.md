# Component registry

Owns 61 versioned infrastructure definitions and the declarative pack contract. `defaultComponents` also retains the eight existing core primitives. Taxonomy and technology identity are separate from the six vendor-neutral semantic categories. The canvas queries this registry rather than owning product lists.

`searchComponents` searches names, aliases, taxonomy, tags and capabilities. `loadPack` validates pack format/version, unique IDs, configuration defaults, directional ports and resource bindings. Packs are JSON data; they cannot execute scripts or supply remote icons. Unknown icon IDs use a local fallback. The catalog can import a pack up to 5 MiB, embeds its definitions and retains its ID/version/license in document metadata. Conflicting definitions require an explicit upgrade; they are never replaced silently.

Each definition has stable identity, independent component/schema versions, a discriminated generic/technology/provider identity, semantic type, catalog category/subcategory, search aliases, locally registered icon ID, configuration and defaults, ports, capabilities, declarative validation rules and capacity-model coverage. Configure provider-specific fields as architectural declarations; this is not a provider API deployment validator.

## Catalog coverage

The current catalog includes 35 concrete technology/provider definitions and 26 generic infrastructure definitions. Coverage includes relational and document databases, key-value storage, caches, message brokers and streams, proxies and content delivery, compute, object storage, search and analytics, container infrastructure and observability. Exact technology names and stable IDs remain in the registry and searchable catalog; documentation uses neutral capability descriptions.

Generic clients, networking, compute, storage and containment definitions support vendor-independent design. Legacy primitives remain available, including existing embedded database definitions with engine selectors. Direct technology insertion is the primary workflow.

## Capacity integration and limits

Registered service/database/cache/queue/router behaviors select the relevant profile editor. Names and provider SKUs never establish measured throughput. Explicit resource configuration binds memory, storage, CPU, replica/read-replica counts, cache hit assumptions and queue buffer/retention to an existing profile during configuration commands. Missing profiles remain missing. Service-time evidence is retained with a recalibration warning when deployment bounds change; a measured profile becomes an assumption for the changed deployment until explicitly recalibrated. Undo retains the original evidence classification.

Broker/topic/partition counts, replication modes, TLS, routing strategy, provider tiers, expected workload descriptions and software versions are persisted engineering declarations. They are not inferred physical performance models. Traffic must be supplied through scenarios and graph flow policies. Distributed log internals, provider quotas/costs, TTL-derived cache misses and hardware-specific deployment behavior require separately calibrated model extensions. A generic queue model does not establish exact provider behavior.

Provider fields are the declarations accepted by the current schema, not a continuously synchronized provider specification. Verify actual deployment constraints against current provider APIs when implementing an adapter. Source research belongs in ignored local notes; [capacity limitations](../../docs/engineering/capacity.md) remain authoritative for supported modeled behavior.

## Compatibility and explicit conversion

`legacyMapping` recognizes an unchanged core database definition with one of the two explicitly supported legacy engine identities. `upgradeLegacyNode` preserves node ID/name, edges, layouts, original configuration keys and metadata, adds validated technology defaults and embeds the new definition. The inspector offers this as one undoable operation. Customized schemas/ports and ambiguous engines retain their original definition. Opening or importing a document does not automatically convert it.

## Pack authoring

Use a `swiftbuild-component-pack` manifest with `packVersion: "1.0"`, stable `id`, `name`, semantic `version`, `license` and a nonempty `components` array. Each component must pass `ComponentDefinitionSchema`, include `catalog` and validated defaults, and pass `loadPack`. Keep field and port IDs stable; document changes requiring migration. Publish test fixtures for search, configuration, compatibility, serialization and capacity coverage. Local pack distribution is implemented; remote registry installation and arbitrary extension code are separate workstreams.
