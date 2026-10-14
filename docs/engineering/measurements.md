# Measurement evidence and CSV

Every performance profile records measured, assumed or illustrative evidence; source; ISO timestamp; hardware/workload/deployment context; and limitations. Marking a value measured is a user assertion, not automatic verification. Local CSV imports do not change the evidence classification.

Select the object, complete its evidence context and import a CSV no larger than 5 MiB. Invalid data leaves the profile unchanged. Save the profile explicitly after import.

For empirical local service samples:

```csv
service_ms
10
12
18
```

Samples must be finite and positive, with at least two and at most 10,000 values. When CPU is modeled separately, samples describe non-CPU delay and must come from an appropriate decomposed measurement.

For measured capacity curves:

```csv
requests_per_second,mean_latency_ms,p95_latency_ms,p99_latency_ms
10,12,20,30
20,18,35,50
```

The first two columns are required; percentile columns are optional. Rates must be strictly increasing, all values finite and nonnegative, and curves contain at most 1,000 points. Quotes, escaped quotes, CRLF and a UTF-8 BOM are accepted. After a closing quote, only spaces or tabs may precede a delimiter, line ending or end of file. Unknown/duplicate columns, malformed quotes and inconsistent row widths are rejected. Quote errors identify the source row and field; decoded numeric cells must still be finite numbers.

Curve latency must describe the local operating context claimed by the profile. Do not substitute end-to-end latency for local service demand. Compare measured observations against simulation results and revise assumptions rather than extrapolating outside measured ranges.
