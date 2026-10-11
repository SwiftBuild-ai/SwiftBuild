# Worked illustrative example

Choose **Architecture templates → Use engineering example**. Every supplied performance profile is labeled illustrative; none represents a benchmark of real hardware.

The baseline has 20 requests/s, 90% reads and 10% writes. Request and response payloads are 512 and 4,096 bytes. Each new write creates a 2,048-byte object retained for 30 days. Growth is zero. A separate burst triples arrival rate from simulation seconds 100 through 130.

## Hand-calculated analytical references

| Quantity                     | Calculation                                           | Baseline result      |
| ---------------------------- | ----------------------------------------------------- | -------------------- |
| API demand                   | 20 × 1 call                                           | 20 operations/s      |
| Cache lookups                | 20 × 0.9 reads                                        | 18 operations/s      |
| Database reads               | 18 × (1 − 0.9 hit ratio)                              | 1.8 operations/s     |
| Database writes              | 20 × 0.1 writes                                       | 2 operations/s       |
| Database total               | 1.8 + 2                                               | 3.8 operations/s     |
| Payload bandwidth            | 20 × (512 + 4,096)                                    | 92,160 bytes/s       |
| Retained new writes          | 2 × 2,048 × 30 × 86,400                               | 10,616,832,000 bytes |
| API service-slot utilization | 20 × 0.020 / (2 slots × 2 explicitly linear replicas) | 0.10                 |

Storage is a lower bound that excludes existing records, updates, indexes and replication overhead. Service slots do not establish CPU utilization. No CPU demand was supplied, so that result remains unknown.

## Simulation interpretation

The default 30-second warm-up and 300-second observation include the 30-second burst. Expected offered average is `(20 × 270 + 60 × 30) / 300 = 24 requests/s`, not 20. Poisson arrivals vary around this expectation. Completed throughput can differ because of failures, drops and work still outstanding at observation end.

Open a metric to inspect its model, assumptions and provenance. Compare analytical baseline demand with simulated bursts; the baseline cannot explain transient waiting by itself. Inspect the work-accounting identity and time-series table. A sampling interval describes the declared random model, not whether the illustrative service times predict production.

Replace profiles with representative measurements before making engineering decisions. Record the workload, deployment context, measurement date and applicable range, then rerun. Changing semantics marks old results stale; moving a card does not.
