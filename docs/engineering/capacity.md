# Capacity models and numerical limitations

Engine/model versions are recorded in every report. `estimateScenario`, `analyzeTopology` and `simulateTopology` use the same validated scenarios. `inputFingerprint` is the canonical semantic input string, excluding layout, generated findings/estimates, assessments and checkpoint metadata. Collections, reference lists and declarative arrays are compared independently of insertion order. Empirical samples are normalized for seeded replay. Simulation reports include actual run settings; overrides enter the fingerprint without modifying the source document.

## Workload estimates

Direct traffic uses operations per second. User-derived traffic uses `daily active users × requests per user per day / 86400`. Forecast rate is `base × peak multiplier × (1 + monthly growth/100)^months`.

Retained writes are `forecast rate × write fraction × object bytes × retention seconds`. This holds the forecast rate constant across the retention window; it is not an integral over historical growth. Each write creates an object. Updates, compression, indexes and replication overhead are not inferred. Payload bandwidth is `rate × (request bytes + response bytes)`; transport overhead is excluded.

Additional burst intervals are simulated as piecewise rates. The analytical baseline does not silently treat a brief burst as permanent traffic.

Unspecified payload sizes, object sizes and retention remain unknown rather than becoming zero. Link serialization requires declared request and response sizes. Retained-new-write utilization excludes preexisting data and is explicitly a lower bound; it cannot establish how much storage is free.

## Topology propagation

Each traffic class carries read/write proportions through explicit calls, routing fractions and bounded retries. Expected retry amplification is `Σ probability^attempt` from zero through the declared maximum retry count. It assumes independent failures; timeouts and load-dependent feedback need simulation.

Independent flow policies issue independent calls. Exclusive routing selects one weighted destination within a group; weights must sum to one. `cache-miss` routes reads that miss an explicitly referenced cache. `cache-aside` also sends writes directly to durable storage. Hit ratio is supplied as evidence, never inferred from cache size or TTL.

Recursive graph cycles are rejected as unsupported. Bounded retries are represented by policy and do not require recursive graph edges. Boundaries consume no artificial processing demand. Router profiles explicitly model zero local overhead; use a service profile when router processing performance matters.

## Processing and resources

Service slots describe local processing concurrency, not CPU utilization. Homogeneous replicas multiply slots only with an explicit linear-scaling assumption. Database writes always use the primary pool. Zero additional read replicas shares the primary; explicitly declared read replicas form a separate balanced read pool.

CPU demand is CPU seconds per operation. Allocated cores describe the node's modeled resource pool. Coupled CPU simulation requires separately declared non-CPU delay: CPU processing occurs first, followed by that delay. Total latency alone cannot identify those phases. Fractional cores use equally slowed virtual processors. Declared per-operation memory is reserved during local processing, including CPU waiting; unavailable allocations remain unknown. Slots and memory release before downstream dependency execution.

Analytical CPU utilization is `offered rate × CPU seconds per operation / allocated cores`. Shared CPU limits cannot be repaired by recommending more service slots. Measured capacity curves use linear interpolation only inside their recorded range. They do not identify service-time distributions or permit invented extrapolation.

## Queueing and simulation

Closed-form queueing uses Erlang-C only under declared Poisson arrivals and exponential local service, stationary load, FCFS and an infinite waiting buffer. Downstream transformations can violate independence. At utilization one or above there is no finite steady-state wait; the result is unstable, not an infinity encoded into JSON.

The discrete-event engine uses seeded regular/Poisson arrivals and constant, exponential or empirical service distributions. Sequential stages wait for their dependencies. Parallel dependencies join. Asynchronous background work is excluded from foreground completion latency but remains in component queues. Timeouts do not cancel already dispatched downstream work.

Queue models maintain finite unacknowledged message limits, competing consumer groups or broadcast subscribers, acknowledgement timing, retention, bounded consumer retries and dead-letter outcome counts. Dead-letter outcomes do not execute recovery jobs. Initial backlog without traffic-class attribution is reported as unsupported rather than assigned invented work.

Default execution: five independent replications, 30 seconds warm-up, 300 seconds observation, two million events and 30 seconds execution. Budgets are configurable within validated bounds. Reaching a budget or cancelling produces an incomplete report.

Foreground accounting is `offered = completed + failed + dropped + outstanding`. Admitted excludes requests ultimately dropped. Inspect this alongside completed throughput. Percentiles use completed observed requests and nearest-rank calculation; failed and right-censored work cannot disappear from a strict-deadline assessment.

The throughput sampling interval uses a conservative Student-t critical value for at least five independent replications. It describes randomness under the declared model, not confidence that assumptions match production. Representative load testing and calibration remain necessary.

## Verification

Random streams use public-domain xoshiro128** with SplitMix64 initialization and the published 2^64-step jump between replications. Canonical node/edge ordering keeps seeded results independent of collection insertion order. Scheduling has a 100,000-event queue ceiling, and fan-out is bounded; hitting those limits is incomplete. Exact Erlang-C evaluation is bounded to 100,000 service slots; larger wait estimates remain unknown. These numerical safeguards do not manufacture finite results for unstable models.

Unit fixtures cover hand-calculated traffic and queueing, cache extremes, read/write behavior, retry amplification, sequential/parallel execution, finite queue saturation, dead-letter outcomes, CPU contention, cancellation and operating-range enforcement. The 1,000-node benchmark writes machine, timings, processed events and memory measurements to ignored local output. Run `pnpm benchmark:capacity`; hardware-specific timings are not performance guarantees.
