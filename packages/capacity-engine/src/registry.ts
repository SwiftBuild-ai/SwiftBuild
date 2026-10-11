export const behaviorRegistry = {
  service: {
    version: '1.0',
    description: 'Local service-slot processing with explicit dependencies.',
    limitations: [
      'Homogeneous replicas scale only when explicitly declared.',
      'Slots release before downstream dependency execution.',
    ],
  },
  database: {
    version: '1.0',
    description:
      'Primary read/write pool or explicit independent read replicas.',
    limitations: [
      'Write capacity is never multiplied by replica count.',
      'Sharding and quorum behavior require a separately defined model.',
    ],
  },
  cache: {
    version: '1.0',
    description: 'Local cache processing and explicitly declared hit ratio.',
    limitations: [
      'Hit ratio is not inferred from memory or TTL.',
      'Warm-up and eviction dynamics are not inferred.',
    ],
  },
  queue: {
    version: '1.0',
    description:
      'Finite unacknowledged buffer, explicit consumer groups, retries and retention.',
    limitations: [
      'Unattributed initial backlog cannot be simulated.',
      'Dead-letter handling records outcomes; it does not execute recovery jobs.',
    ],
  },
  router: {
    version: '1.0',
    description:
      'Explicit weighted routing without invented local processing overhead.',
    limitations: [
      'Declare a service model instead if router processing capacity must be assessed.',
    ],
  },
} as const;
