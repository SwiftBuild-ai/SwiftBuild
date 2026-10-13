# Computation contracts

Pure, runtime-validated TypeScript contracts for execution envelopes, numerical reports, job adapters and historical analysis bundles. Analysis definitions come from the separate `@swiftbuild/architecture-schema/analysis` export. No authentication, persistence, provider or UI dependencies belong here.

`pnpm computation:generate` generates committed JSON Schema; the pinned Python `generate_models.py` generates Pydantic types from that schema. Both check commands must pass without drift. Shared accepted/rejected and canonicalization fixtures exercise both runtimes. RFC 8785 canonical JSON and SHA-256 identify normalized inputs independently of existing native fingerprints.

Contract, bundle and numerical model versions are separate. Result values and derivative slopes carry explicit units. Successful reports are finite and traceable; missing metrics remain unknown. No architecture validation or TypeScript simulation is reimplemented in Python. See [engineering behavior](../../docs/engineering/analysis.md) and [service ownership](../../docs/adr/0009-engineering-computation-service.md).
