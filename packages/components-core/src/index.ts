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
