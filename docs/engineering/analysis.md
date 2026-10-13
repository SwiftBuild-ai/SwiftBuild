# Engineering analysis

The Engineering analysis workbench runs against an immutable saved server revision. Save current edits before submission. Owners/editors can create and cancel jobs; viewers can inspect and export authorized results. Reloading the browser does not restart a job. Definitions and reports are stored by the TypeScript backend independently of the native document and project archive.

## Reliability

Quick setup selects components, operating/repair means in seconds, explicit all/any/k-of-n success conditions, and source/context. These inputs are classified as assumed. Advanced typed definitions support measured provenance, nested gates and shared failure groups. A group outage disables all declared members. A repeated component reference represents the same random variable; it does not become a second independent component.

Stationary availability is `meanUpSeconds / (meanUpSeconds + meanRepairSeconds)`. Operating time must be positive; repair time may be zero. Component variables and shared-group variables are independent. That independence is an explicit modeling assumption, not a fact inferred from the architecture. Failure impact forces one component/group unavailable and recomputes system success; it is an intervention rather than conditional probability.

Up to 16 variables use exact state enumeration. Larger models use seeded PCG64 sampling. Reports show a 95% Wilson sampling interval for the baseline estimate. Sampling intervals do not quantify modeling error. Failure-impact and sensitivity estimates use common seeded samples; they do not include independent confidence bounds. Repair-event timelines, recovery dependencies, and arbitrary failure distributions remain planned.

Optional one-parameter-at-a-time ranges compute availability and finite-difference slopes within the declared points. Shared inputs retain stable identity. Cycles, missing references, duplicate gate inputs and invalid thresholds are rejected before queueing.

## Capacity sensitivity

Choose a saved scenario, the existing analytical or seeded simulation engine, parameter target, distinct numeric values, and a system/node metric. Supported parameters are rate workload requests per second, peak multiplier, distribution mean milliseconds, concurrency, and replicas. Empirical distributions do not support mean replacement. Every derived document passes the same TypeScript validation and engine as a direct run.

Python calculates finite differences from those samples. Unsupported analytical assumptions, absent measurements, incomplete simulations and unknown metrics remain visible and yield partial reports. Values outside capacity curves are never extrapolated. Seeded sampling variation is not a causal guarantee.

## Budgets, state and portability

Defaults: one active job per workspace, ten queued jobs per workspace, 50 range evaluations, 10,000 samples (maximum 100,000), 120 seconds, and 8 MiB input/result limits. Reliability definitions allow at most 100 components, 100 groups and 100 gates. Forced-outage checks share the same execution deadline as sensitivity evaluation. Large models may time out rather than finish all requested evidence.

States are queued, running, cancelling, completed, partial, cancelled, timed-out and failed. Workers renew 15-second leases every three seconds. Expired leases permit at most two attempts. Revoked admission cancels unfinished work; every subsequent read still requires current authorization. Errors and uncertain submissions preserve local work. An unconfirmed analysis definition is retained under the current user/project key for retry after reload.

Exported `swiftbuild-analysis` bundles use version 1.0 and include normalized inputs and reports. Import requires the same authorized server project and an existing referenced revision, validates digest and schemas, and stores historical results without execution. Bundles are not project archives and do not prove that imported results are trustworthy measurements. Use an imported definition for a new run to recompute against the current saved revision.

Reports record the input digest, model/runtime versions, platform, RNG and image identifier. Layout is not passed to Python. Replay uses the recorded input; an image identifier is an operator-supplied identifier, so operators should pin and record the actual deployed image digest for release-grade replay. Existing TypeScript fingerprints remain unchanged. Use tolerance `1e-9` for independently derived numerical comparisons across platforms.

See [deployment and recovery](../self-hosting/computation.md), [API contracts](../server-api.md), and the [ownership decision](../adr/0009-engineering-computation-service.md).
