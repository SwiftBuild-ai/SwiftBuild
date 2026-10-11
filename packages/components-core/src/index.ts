import {
  ComponentDefinitionSchema,
  parseDocument,
  type ArchitectureDocument,
  type ComponentDefinition,
  type ConfigurationField,
  type Relationship,
} from '@swiftbuild/architecture-schema';
const field = (
  key: string,
  label: string,
  type: ConfigurationField['type'],
  value: ConfigurationField['default'],
  extras: Partial<ConfigurationField> = {},
): ConfigurationField => ({
  key,
  label,
  type,
  default: value,
  required: true,
  ...extras,
});
const port = (
  id: string,
  label: string,
  direction: 'input' | 'output',
  relationships: Relationship[],
) => ({ id, label, direction, relationships });
const def = (
  id: string,
  name: string,
  category: ComponentDefinition['category'],
  description: string,
  configurationSchema: ConfigurationField[],
  ports: ComponentDefinition['ports'],
  capabilities: string[],
): ComponentDefinition =>
  ComponentDefinitionSchema.parse({
    id: `core.${id}`,
    name,
    category,
    description,
    configurationSchema,
    ports,
    capabilities,
    version: '1.0.0',
    schemaVersion: '1.0',
    constraints: [],
    documentation: `Generic ${name.toLowerCase()} architecture primitive.`,
    icon: id,
    tags: [category, 'generic'],
  });
export const coreComponents: ComponentDefinition[] = [
  def(
    'client',
    'Client',
    'client',
    'A user-facing application or external caller.',
    [
      field('platform', 'Platform', 'select', 'Web', {
        options: ['Web', 'Mobile', 'External'],
      }),
    ],
    [port('out', 'Requests', 'output', ['request', 'public-access'])],
    ['request-origin'],
  ),
  def(
    'service',
    'Service',
    'compute',
    'A stateless workload with explicit dependencies.',
    [
      field('runtime', 'Runtime', 'select', 'Node.js', {
        options: ['Node.js', 'Python', 'Go', 'Java', 'Other'],
      }),
      field('replicas', 'Replicas', 'number', 2, { min: 1, max: 1000 }),
      field('healthChecks', 'Health checks', 'boolean', true),
      field('region', 'Region', 'string', 'Primary'),
    ],
    [
      port('in', 'Requests', 'input', ['request', 'public-access']),
      port('out', 'Dependencies', 'output', [
        'request',
        'cache-lookup',
        'database-connection',
        'async-message',
      ]),
    ],
    ['compute', 'stateless'],
  ),
  def(
    'database',
    'Database',
    'database',
    'Durable data with consistency and replication.',
    [
      field('engine', 'Engine', 'select', 'PostgreSQL', {
        options: ['PostgreSQL', 'MySQL', 'Document', 'Key-value'],
      }),
      field('replicas', 'Replicas', 'number', 1, { min: 1, max: 100 }),
      field('consistency', 'Consistency', 'select', 'Strong', {
        options: ['Strong', 'Eventual'],
      }),
      field('backups', 'Backups', 'boolean', true),
      field('storageGB', 'Storage (GB)', 'number', 100, { min: 1 }),
    ],
    [
      port('in', 'Connections', 'input', ['database-connection']),
      port('replication', 'Replication', 'output', ['replication']),
      port('replica', 'Replica input', 'input', ['replication']),
    ],
    ['durable-storage', 'transactions'],
  ),
  def(
    'cache',
    'Cache',
    'cache',
    'Fast reads with an explicit expiration strategy.',
    [
      field('ttlSeconds', 'TTL (seconds)', 'number', 300, { min: 1 }),
      field('eviction', 'Eviction policy', 'select', 'LRU', {
        options: ['LRU', 'LFU', 'FIFO'],
      }),
      field('memoryGB', 'Memory (GB)', 'number', 2, { min: 0.1 }),
    ],
    [port('in', 'Lookups', 'input', ['cache-lookup'])],
    ['ephemeral-storage', 'low-latency'],
  ),
  def(
    'queue',
    'Queue',
    'messaging',
    'Asynchronous delivery between independent services.',
    [
      field('delivery', 'Delivery', 'select', 'At least once', {
        options: ['At least once', 'At most once'],
      }),
      field('deadLetter', 'Dead-letter queue', 'boolean', true),
      field('retentionHours', 'Retention (hours)', 'number', 24, { min: 1 }),
    ],
    [
      port('in', 'Publish', 'input', ['async-message']),
      port('out', 'Consume', 'output', ['async-message']),
    ],
    ['asynchronous-delivery'],
  ),
  def(
    'boundary',
    'Boundary',
    'boundary',
    'A deployment or trust boundary that contains components.',
    [
      field('kind', 'Boundary type', 'select', 'Deployment', {
        options: ['Deployment', 'Network', 'Trust'],
      }),
      field('region', 'Region', 'string', 'Primary'),
    ],
    [],
    ['containment'],
  ),
  def(
    'worker',
    'Worker',
    'compute',
    'Processes asynchronous messages with explicit dependencies.',
    [
      field('runtime', 'Runtime', 'select', 'Node.js', {
        options: ['Node.js', 'Python', 'Go', 'Java', 'Other'],
      }),
      field('replicas', 'Replicas', 'number', 2, { min: 1, max: 1000 }),
      field('healthChecks', 'Health checks', 'boolean', true),
      field('region', 'Region', 'string', 'Primary'),
    ],
    [
      port('in', 'Messages', 'input', ['async-message', 'event-stream']),
      port('out', 'Dependencies', 'output', [
        'request',
        'cache-lookup',
        'database-connection',
        'async-message',
      ]),
    ],
    ['compute', 'asynchronous-consumer'],
  ),
  def(
    'load-balancer',
    'Load balancer',
    'compute',
    'Routes incoming requests across explicitly weighted destinations.',
    [
      field('replicas', 'Replicas', 'number', 2, { min: 1, max: 1000 }),
      field('healthChecks', 'Health checks', 'boolean', true),
      field('region', 'Region', 'string', 'Primary'),
    ],
    [
      port('in', 'Requests', 'input', ['request', 'public-access']),
      port('out', 'Backends', 'output', ['request']),
    ],
    ['weighted-routing'],
  ),
];
export function blankDocument(): ArchitectureDocument {
  return parseDocument({
    schemaVersion: '1.0',
    project: {
      id: 'project-local',
      name: 'Starter project',
      description: 'A new system design.',
    },
    architecture: {
      id: 'architecture-main',
      name: 'New architecture',
      description: '',
    },
    components: coreComponents,
    nodes: [],
    edges: [],
    views: [
      { id: 'view-system', name: 'System view', nodeIds: [], layout: {} },
    ],
  });
}
export function sampleDocument(): ArchitectureDocument {
  const doc = blankDocument();
  doc.project.name = 'Commerce platform';
  doc.architecture.name = 'System architecture';
  doc.project.description = 'A resilient foundation for an online storefront.';
  doc.nodes = [
    {
      id: 'client',
      componentId: 'core.client',
      componentVersion: '1.0.0',
      name: 'Web application',
      configuration: { platform: 'Web' },
      metadata: {},
    },
    {
      id: 'service',
      componentId: 'core.service',
      componentVersion: '1.0.0',
      name: 'Storefront API',
      configuration: {
        runtime: 'Node.js',
        replicas: 2,
        healthChecks: true,
        region: 'Primary',
      },
      metadata: {},
    },
    {
      id: 'cache',
      componentId: 'core.cache',
      componentVersion: '1.0.0',
      name: 'Session cache',
      configuration: { ttlSeconds: 300, eviction: 'LRU', memoryGB: 2 },
      metadata: {},
    },
    {
      id: 'database',
      componentId: 'core.database',
      componentVersion: '1.0.0',
      name: 'Primary database',
      configuration: {
        engine: 'PostgreSQL',
        replicas: 1,
        consistency: 'Strong',
        backups: true,
        storageGB: 100,
      },
      metadata: {},
    },
  ];
  doc.edges = [
    {
      id: 'edge-request',
      source: { nodeId: 'client', portId: 'out' },
      target: { nodeId: 'service', portId: 'in' },
      relationship: 'request',
      label: 'HTTPS',
      metadata: {},
    },
    {
      id: 'edge-cache',
      source: { nodeId: 'service', portId: 'out' },
      target: { nodeId: 'cache', portId: 'in' },
      relationship: 'cache-lookup',
      label: 'Cache lookup',
      metadata: {},
    },
    {
      id: 'edge-database',
      source: { nodeId: 'service', portId: 'out' },
      target: { nodeId: 'database', portId: 'in' },
      relationship: 'database-connection',
      label: 'SQL connection',
      metadata: {},
    },
  ];
  doc.views[0]!.nodeIds = doc.nodes.map((n) => n.id);
  doc.views[0]!.layout = {
    client: { x: 60, y: 220 },
    service: { x: 400, y: 220 },
    cache: { x: 770, y: 100 },
    database: { x: 770, y: 340 },
  };
  return doc;
}
/** Demonstration inputs are illustrative, never advertised as measured capacity. */
export function engineeringSampleDocument(): ArchitectureDocument {
  const document = sampleDocument();
  return parseDocument({
    ...document,
    scenarios: [
      {
        id: 'scenario-baseline',
        name: 'Storefront baseline',
        description: 'Illustrative traffic for exploring capacity workflows.',
        assumptions:
          'Illustrative workload and service times. Replace these with representative measurements before using results for production decisions.',
        trafficClasses: [
          {
            id: 'traffic-storefront',
            name: 'Storefront requests',
            entryNodeId: 'client',
            workload: { kind: 'rate', requestsPerSecond: 20 },
            readFraction: 0.9,
            payloadBytes: 512,
            responseBytes: 4096,
            objectBytes: 2048,
            retentionDays: 30,
            arrivals: 'poisson',
            bursts: [{ startSeconds: 100, durationSeconds: 30, multiplier: 3 }],
          },
        ],
        targets: [
          {
            id: 'target-latency',
            metric: 'p95-latency',
            comparator: 'at-most',
            value: 150,
            unit: 'ms',
          },
        ],
      },
    ],
    performanceProfiles: [
      {
        id: 'profile-service',
        nodeId: 'service',
        model: 'service',
        serviceTime: { kind: 'exponential', meanMs: 20 },
        concurrency: 2,
        replicas: 2,
        scaling: 'linear',
      },
      {
        id: 'profile-cache',
        nodeId: 'cache',
        model: 'cache',
        serviceTime: { kind: 'constant', meanMs: 1 },
        concurrency: 4,
        cacheHitRatio: 0.9,
        memoryBytes: 2e9,
      },
      {
        id: 'profile-database',
        nodeId: 'database',
        model: 'database',
        serviceTime: { kind: 'exponential', meanMs: 8 },
        concurrency: 2,
        storageBytes: 100e9,
      },
    ].map((p) => ({
      ...p,
      provenance: {
        kind: 'illustrative',
        source: 'SwiftBuild engineering example',
        context: 'Synthetic example inputs; no hardware benchmark.',
        recordedAt: '2026-10-10T00:00:00Z',
        limitations:
          'These numbers demonstrate the model, not vendor or production performance.',
      },
    })),
    flowPolicies: [
      {
        id: 'policy-request',
        edgeId: 'edge-request',
        callsPerOperation: 1,
        assumption: 'One API call per external request.',
      },
      {
        id: 'policy-cache',
        edgeId: 'edge-cache',
        callsPerOperation: 1,
        operation: 'read',
        assumption: 'Reads first consult the cache.',
        order: 0,
      },
      {
        id: 'policy-database',
        edgeId: 'edge-database',
        callsPerOperation: 1,
        operation: 'cache-aside',
        cacheNodeId: 'cache',
        assumption: 'Read misses and all writes reach durable storage.',
        order: 1,
      },
    ],
    requirements: [
      {
        id: 'requirement-checkout',
        title: 'Responsive storefront',
        description:
          'Keep storefront requests within the declared latency target under the baseline workload.',
        nodeIds: ['service', 'cache', 'database'],
      },
    ],
    assessments: [
      {
        id: 'assessment-checkout',
        requirementId: 'requirement-checkout',
        scenarioId: 'scenario-baseline',
        targetId: 'target-latency',
        status: 'unknown',
        evidence: 'Awaiting a complete simulation with current inputs.',
      },
    ],
    decisions: [
      {
        id: 'decision-cache',
        title: 'Cache frequently read data',
        context: 'Read-heavy storefront traffic reaches durable storage.',
        alternatives: [
          'Read durable storage directly',
          'Use an explicit cache-aside path',
        ],
        reason:
          'Explore the effect of an explicitly assumed hit ratio on downstream demand.',
        consequences:
          'Cache misses and writes still require storage capacity; hit ratio must be measured.',
        status: 'proposed',
        nodeIds: ['cache', 'database'],
        edgeIds: ['edge-cache', 'edge-database'],
        requirementIds: ['requirement-checkout'],
      },
    ],
  });
}
