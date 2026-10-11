const rules = [
  [
    'redundancy',
    'Configured redundancy',
    'A production designation activates the minimum replica policy. Replica counts do not prove independent failure domains or successful failover.',
  ],
  [
    'health-checks',
    'Health checks',
    'An explicitly disabled health check is flagged for production workloads. Enabling configuration must be followed by testing actual readiness and liveness behavior.',
  ],
  [
    'backups',
    'Backups',
    'Production durable storage should have backups enabled and restoration tested. The document cannot prove that operational backups exist.',
  ],
  [
    'dead-letter',
    'Dead-letter handling',
    'Explicitly disabled dead-letter handling is flagged. Review retry exhaustion, poison messages, retention and recovery procedures.',
  ],
  [
    'trust-exposure',
    'External storage exposure',
    'A direct external or public path into durable storage requires review of authentication, authorization and network protection.',
  ],
  [
    'trust-boundary',
    'Trust-boundary crossings',
    'Crossing a declared trust boundary requires evidence of transport protection and authorization. Containment alone does not provide that evidence.',
  ],
  [
    'measurements',
    'Performance evidence',
    'Measured profiles require a source, date and operating context. Assumed and illustrative values remain visible as such and do not establish production capacity.',
  ],
  [
    'model-coverage',
    'Model coverage',
    'Supply missing routing policies and service-time distributions. Unsupported recursive routing and unattributed initial backlog are reported instead of simulated with invented behavior.',
  ],
  [
    'overload',
    'Capacity and overload',
    'Offered load can exceed processing capacity. Queueing delay is unstable at or above utilization one. Simulate finite buffers, bursts and admission outcomes before interpreting completed throughput.',
  ],
  [
    'queue-stability',
    'Queue stability',
    'Growing backlog indicates offered production exceeds consumer capacity. Review independent consumer groups, acknowledgements, finite buffers and retention.',
  ],
  [
    'storage',
    'Retained storage',
    'Retention estimates assume each modeled write creates an object. Compression, updates, indexes, replication and metadata overhead need explicit assumptions.',
  ],
  [
    'targets',
    'Performance targets',
    'A target can be assessed only from a complete matching result. Stale or incomplete simulation output does not satisfy a requirement. Unknown is a legitimate outcome.',
  ],
];
export default function Guide() {
  return (
    <main
      style={{
        maxWidth: 780,
        margin: '0 auto',
        padding: '48px 24px',
        lineHeight: 1.8,
      }}
    >
      <a href="/">← Return to SwiftBuild</a>
      <p>SWIFTBUILD ENGINEERING GUIDE</p>
      <h1>Understand the evidence behind the design</h1>
      <p>
        SwiftBuild evaluates a declared architecture model. Results expose
        formulas, assumptions, units and limitations; they do not replace
        production load tests or operational verification.
      </p>
      <h2>Capacity methods</h2>
      <p>
        Workload estimates calculate external traffic, retained writes and
        payload bandwidth. Analytical topology propagation calculates offered
        demand through explicit flow policies. Discrete-event simulation models
        local service-slot contention, dependencies, parallel joins,
        time-varying traffic, queue acknowledgement, finite buffers, retries,
        timeouts and network serialization.
      </p>
      <p>
        Service slots release when local processing finishes. Synchronous
        dependencies still contribute to foreground latency. Unmodeled resource
        coupling and unsupported behaviors must be reviewed separately. Capacity
        curves are interpolated only within their supplied range and cannot
        identify a service-time distribution.
      </p>
      <h2>Reproducibility and confidence</h2>
      <p>
        Seeded replications share the same declared inputs. A sampling interval
        measures stochastic variation under that model, not confidence that its
        assumptions match production. Budget-limited runs are incomplete.
        Inspect dropped, failed and outstanding work alongside latency
        percentiles.
      </p>
      <h2>Engineering rules</h2>
      {rules.map(([id, title, body]) => (
        <section
          id={id}
          key={id}
          style={{
            scrollMarginTop: 24,
            borderTop: '1px solid var(--border)',
            padding: '20px 0',
          }}
        >
          <h3>{title}</h3>
          <p>{body}</p>
        </section>
      ))}
      <h2>Local persistence</h2>
      <p>
        Your workspace, checkpoints and run summaries remain in this browser
        using transactional IndexedDB. Export a project archive for a portable
        backup. Native architecture JSON is limited to 5 MB; project archives
        are limited to 50 MB. Clearing browser data removes local work.
      </p>
    </main>
  );
}
