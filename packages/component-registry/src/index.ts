import { z } from 'zod';
import {
  ComponentDefinitionSchema,
  configurationErrors,
  type ComponentDefinition,
  type ConfigurationField,
  type ArchitectureDocument,
} from '@swiftbuild/architecture-schema';
import { coreComponents, sampleDocument } from '@swiftbuild/components-core';
export const catalogCategories = [
  { id: 'clients', label: 'Clients & interfaces' },
  { id: 'networking', label: 'Networking & delivery' },
  { id: 'compute', label: 'Compute & services' },
  { id: 'databases', label: 'Databases' },
  { id: 'caching', label: 'Caching' },
  { id: 'messaging', label: 'Messaging & streaming' },
  { id: 'storage', label: 'Storage' },
  { id: 'search', label: 'Search & analytics' },
  { id: 'observability', label: 'Infrastructure & observability' },
  { id: 'constructs', label: 'Architecture constructs' },
] as const;
type Group = (typeof catalogCategories)[number]['id'];
const number = (
  key: string,
  label: string,
  value: number,
  unit?: string,
  min = 0,
  max?: number,
): ConfigurationField => ({
  key,
  label,
  type: 'number',
  default: value,
  required: true,
  min,
  max,
  unit,
  description:
    'Declared architecture input; does not establish measured performance.',
});
const count = (
  key: string,
  label: string,
  value: number,
  min = 1,
  max = 10000,
): ConfigurationField => ({
  ...number(key, label, value, undefined, min, max),
  integer: true,
});
const text = (
  key: string,
  label: string,
  value: string,
): ConfigurationField => ({
  key,
  label,
  type: 'string',
  default: value,
  required: true,
});
const choice = (
  key: string,
  label: string,
  value: string,
  options: string[],
): ConfigurationField => ({
  key,
  label,
  type: 'select',
  default: value,
  required: true,
  options,
});
const boolean = (
  key: string,
  label: string,
  value: boolean,
): ConfigurationField => ({
  key,
  label,
  type: 'boolean',
  default: value,
  required: true,
});
const deployment = [
  count('replicas', 'Replicas', 1),
  number('cpuCores', 'Allocated CPU', 2, 'cores', 0.1),
  number('memoryGB', 'Allocated memory', 4, 'GB', 0.1),
  boolean('healthChecks', 'Health checks', true),
];
const db = [
  text('version', 'Database version', 'Declared'),
  choice('deploymentMode', 'Deployment mode', 'Self-hosted', [
    'Self-hosted',
    'Managed',
  ]),
  ...deployment,
  number('storageGB', 'Storage capacity', 100, 'GB', 1),
  count('maxConnections', 'Connection limit', 100),
  count('readReplicas', 'Read replicas', 0, 0),
  choice('replicationMode', 'Replication mode', 'None', [
    'None',
    'Asynchronous',
    'Synchronous',
  ]),
  boolean('backups', 'Backups', true),
  choice('availability', 'Availability configuration', 'Single zone', [
    'Single zone',
    'Multiple zones',
  ]),
  choice('consistency', 'Consistency', 'Strong', ['Strong', 'Eventual']),
  number('readRPS', 'Expected reads', 0, 'ops/s'),
  number('writeRPS', 'Expected writes', 0, 'ops/s'),
];
const cache = [
  number('memoryGB', 'Memory capacity', 4, 'GB', 0.1),
  number('hitRatio', 'Cache hit-rate assumption', 0.9, 'ratio', 0, 1),
  choice('eviction', 'Eviction policy', 'allkeys-lru', [
    'allkeys-lru',
    'allkeys-lfu',
    'volatile-lru',
    'noeviction',
  ]),
  choice('persistence', 'Persistence mode', 'None', [
    'None',
    'Snapshot',
    'Append-only',
    'Snapshot and append-only',
  ]),
  count('replicas', 'Replicas', 1),
  boolean('cluster', 'Cluster enabled', false),
  number('ttlSeconds', 'TTL assumption', 300, 's', 0),
  number('expectedRPS', 'Expected operations', 0, 'ops/s'),
];
const queue = [
  choice('delivery', 'Delivery', 'At least once', [
    'At least once',
    'At most once',
  ]),
  boolean('deadLetter', 'Dead-letter handling', true),
  number('retentionHours', 'Retention', 24, 'hours', 0.01),
  count('bufferMessages', 'Buffer capacity', 10000),
  number('messageBytes', 'Message size', 1024, 'bytes', 0),
  number('producerRPS', 'Producer throughput assumption', 0, 'messages/s'),
  number('consumerRPS', 'Consumer throughput assumption', 0, 'messages/s'),
];
const proxy = [
  choice('protocol', 'Protocol', 'HTTPS', ['HTTP', 'HTTPS', 'TCP', 'UDP']),
  text('listeners', 'Listeners', '443'),
  text('backends', 'Backend services', 'Not yet linked'),
  choice('routing', 'Routing strategy', 'Round robin', [
    'Round robin',
    'Least connections',
    'Consistent hash',
    'Weighted',
  ]),
  boolean('tlsTermination', 'TLS termination', true),
  ...deployment,
  count('connections', 'Connection assumption', 1000),
];
const store = [
  number('storageGB', 'Storage capacity', 100, 'GB', 1),
  boolean('backups', 'Backups', true),
  choice('access', 'Access scope', 'Private', ['Private', 'Public']),
  number('retentionDays', 'Retention', 30, 'days', 0),
  number('objectBytes', 'Object size assumption', 1024, 'bytes', 0),
];
const constructs = [
  text('region', 'Region', 'Primary'),
  text('purpose', 'Purpose', 'Deployment context'),
];
const baseMap = new Map(coreComponents.map((c) => [c.id, c]));
function define(
  id: string,
  name: string,
  group: Group,
  base: string,
  subcategory: string,
  description: string,
  fields: ConfigurationField[],
  icon: string,
  aliases: string[] = [],
  provider?: string,
): ComponentDefinition {
  const primitive = baseMap.get(`core.${base}`)!;
  const semanticType =
    base === 'load-balancer'
      ? 'router'
      : (base as
          | 'client'
          | 'service'
          | 'worker'
          | 'database'
          | 'cache'
          | 'queue'
          | 'boundary');
  const capacityModel = ['service', 'worker'].includes(base)
    ? 'service'
    : ['database', 'cache', 'queue'].includes(base)
      ? base
      : base === 'load-balancer'
        ? 'router'
        : 'unmodeled';
  const bindings: Record<string, { field: string; multiplier: number }> = {};
  for (const [field, target, multiplier] of [
    ['memoryGB', 'memoryBytes', 1e9],
    ['memoryMB', 'memoryBytes', 1e6],
    ['storageGB', 'storageBytes', 1e9],
    ['cpuCores', 'cpuCores', 1],
    ['replicas', 'replicas', 1],
    ['readReplicas', 'readReplicas', 1],
    ['hitRatio', 'cacheHitRatio', 1],
    ['bufferMessages', 'queueBufferMessages', 1],
    ['retentionHours', 'queueRetentionSeconds', 3600],
  ] as const)
    if (fields.some((f) => f.key === field))
      bindings[target] = { field, multiplier };
  return ComponentDefinitionSchema.parse({
    ...primitive,
    id: `infra.${id}`,
    name,
    description,
    version: '1.0.0',
    schemaVersion: '1.1',
    icon,
    configurationSchema: fields.map((f) => ({
      ...f,
      advanced:
        [
          'readRPS',
          'producerRPS',
          'consumerRPS',
          'writeRPS',
          'expectedRPS',
          'connections',
          'cluster',
          'replicationMode',
          'consistency',
          'availability',
          'purpose',
          'region',
          'trigger',
          'purchase',
          'globalTables',
          'readUnits',
          'writeUnits',
        ].includes(f.key) ||
        (base === 'database' &&
          [
            'replicas',
            'cpuCores',
            'memoryGB',
            'healthChecks',
            'version',
            'deploymentMode',
          ].includes(f.key)),
    })),
    tags: [group, subcategory, ...aliases],
    documentation:
      'Architectural declarations, not provider deployment instructions. Capacity requires explicit workload, flow policy and calibrated performance evidence.',
    catalog: {
      category: group,
      subcategory,
      identity: provider
        ? { kind: 'provider', provider, technology: name }
        : { kind: 'technology', technology: name },
      semanticType,
      aliases,
      serializationVersion: '1.0',
      capacityModel,
      resourceBindings: bindings,
      examples: [],
    },
    validationRules: [],
  });
}
const entries: ComponentDefinition[] = [];
const add = (
  id: string,
  name: string,
  group: Group,
  base: string,
  subcategory: string,
  description: string,
  fields: ConfigurationField[],
  icon = id,
  aliases: string[] = [],
  provider?: string,
) =>
  entries.push(
    define(
      id,
      name,
      group,
      base,
      subcategory,
      description,
      fields,
      icon,
      aliases,
      provider,
    ),
  );
for (const [id, name, aliases] of [
  ['postgresql', 'PostgreSQL', ['postgres', 'pg', 'sql', 'relational']],
  ['mysql', 'MySQL', ['sql', 'relational']],
  ['mariadb', 'MariaDB', ['sql', 'relational']],
  ['mongodb', 'MongoDB', ['mongo', 'document', 'nosql']],
  ['dynamodb', 'Amazon DynamoDB', ['dynamo', 'nosql', 'aws']],
  ['cassandra', 'Cassandra', ['wide column', 'nosql']],
  ['cockroachdb', 'CockroachDB', ['distributed sql']],
  ['sqlite', 'SQLite', ['embedded', 'sql']],
] as const) {
  const fields =
    id === 'dynamodb'
      ? [
          choice('billingMode', 'Capacity mode', 'On-demand', [
            'On-demand',
            'Provisioned',
          ]),
          text('region', 'AWS region', 'us-east-1'),
          text('partitionKey', 'Partition key', 'id'),
          number('readUnits', 'Provisioned read units', 5, 'units', 1),
          number('writeUnits', 'Provisioned write units', 5, 'units', 1),
          boolean('globalTables', 'Global tables', false),
          boolean('backups', 'Point-in-time recovery', true),
          number('storageGB', 'Declared storage', 100, 'GB', 1),
        ]
      : db;
  add(
    id,
    name,
    'databases',
    'database',
    id === 'mongodb'
      ? 'Document'
      : id === 'dynamodb'
        ? 'Key-value'
        : 'Persistent data',
    `${name} durable data with explicit deployment and workload assumptions.`,
    fields,
    id,
    [...aliases],
    id === 'dynamodb' ? 'Amazon Web Services' : undefined,
  );
}
for (const [id, name] of [
  ['redis', 'Redis'],
  ['memcached', 'Memcached'],
  ['valkey', 'Valkey'],
] as const)
  add(
    id,
    name,
    'caching',
    'cache',
    'In-memory',
    `${name} cache with declared memory and hit-rate assumptions.`,
    id === 'memcached'
      ? cache.filter((f) => !['persistence', 'cluster'].includes(f.key))
      : cache,
    id,
    ['cache', 'get', 'set'],
  );
for (const [id, name] of [
  ['kafka', 'Apache Kafka'],
  ['rabbitmq', 'RabbitMQ'],
  ['sqs', 'Amazon SQS'],
  ['sns', 'Amazon SNS'],
  ['pulsar', 'Apache Pulsar'],
  ['nats', 'NATS'],
] as const) {
  const fields =
    id === 'kafka' || id === 'pulsar'
      ? [
          count('brokers', 'Broker count', 3),
          count('topics', 'Topic count', 1),
          count('partitions', 'Partition count', 3),
          count('replicationFactor', 'Replication factor', 3),
          ...queue,
        ]
      : id === 'sqs'
        ? [
            choice('queueType', 'Queue type', 'Standard', ['Standard', 'FIFO']),
            text('region', 'AWS region', 'us-east-1'),
            number(
              'visibilitySeconds',
              'Visibility timeout',
              30,
              's',
              0,
              43200,
            ),
            ...queue,
          ]
        : id === 'sns'
          ? [
              text('region', 'AWS region', 'us-east-1'),
              choice('topicType', 'Topic type', 'Standard', [
                'Standard',
                'FIFO',
              ]),
              count('subscribers', 'Declared subscribers', 1),
              ...queue.filter(
                (f) => !['retentionHours', 'bufferMessages'].includes(f.key),
              ),
            ]
          : queue;
  add(
    id,
    name,
    'messaging',
    'queue',
    id === 'kafka' || id === 'pulsar' ? 'Streaming' : 'Messaging',
    `${name} message transport with explicit consumer policies.`,
    id === 'sqs'
      ? fields.map((f) =>
          f.key === 'retentionHours' ? { ...f, min: 1 / 60, max: 336 } : f,
        )
      : fields,
    id,
    ['queue', 'publish', 'consume', 'message'],
    ['sqs', 'sns'].includes(id) ? 'Amazon Web Services' : undefined,
  );
  if (id === 'kafka' || id === 'pulsar')
    entries.at(-1)!.validationRules = [
      {
        kind: 'field-at-most-field',
        field: 'replicationFactor',
        limitField: 'brokers',
        message: 'Replication factor cannot exceed broker count.',
      },
    ];
}
for (const [id, name, sub] of [
  ['nginx', 'NGINX', 'Reverse proxy'],
  ['haproxy', 'HAProxy', 'Load balancer'],
  ['cloudflare', 'Cloudflare CDN', 'CDN'],
] as const)
  add(
    id,
    name,
    'networking',
    'load-balancer',
    sub,
    `${name} traffic delivery with explicit routes and backend relationships.`,
    id === 'cloudflare'
      ? [
          text('zone', 'DNS zone', 'example.com'),
          choice('cachePolicy', 'Cache policy', 'Origin-controlled', [
            'Origin-controlled',
            'Cache static content',
            'Bypass',
          ]),
          boolean('waf', 'Web application firewall', true),
          ...proxy,
        ]
      : proxy,
    id,
    ['http', 'https', 'proxy', 'network'],
    id === 'cloudflare' ? 'Cloudflare' : undefined,
  );
add(
  'rds',
  'Amazon RDS',
  'databases',
  'database',
  'Managed relational',
  'Managed relational database with explicit engine and availability.',
  [
    choice('engine', 'Database engine', 'PostgreSQL', [
      'PostgreSQL',
      'MySQL',
      'MariaDB',
    ]),
    text('instanceClass', 'Instance class', 'Declared'),
    text('region', 'AWS region', 'us-east-1'),
    boolean('multiAZ', 'Multi-AZ deployment', false),
    ...db.filter((f) => f.key !== 'deploymentMode'),
  ],
  'rds',
  ['aws', 'sql', 'managed'],
  'Amazon Web Services',
);
add(
  'ec2',
  'Amazon EC2',
  'compute',
  'service',
  'Virtual machine',
  'Virtual machine deployment and resource declarations.',
  [
    text('instanceType', 'Instance type', 'Declared'),
    text('region', 'AWS region', 'us-east-1'),
    choice('purchase', 'Purchase model', 'On-demand', [
      'On-demand',
      'Reserved',
      'Spot',
    ]),
    ...deployment,
  ],
  'ec2',
  ['aws', 'vm', 'compute'],
  'Amazon Web Services',
);
add(
  'lambda',
  'AWS Lambda',
  'compute',
  'service',
  'Serverless',
  'Event-driven function with explicit resource and concurrency assumptions.',
  [
    text('runtime', 'Runtime', 'Declared'),
    text('region', 'AWS region', 'us-east-1'),
    number('memoryMB', 'Allocated memory', 512, 'MB', 128, 10240),
    number('timeoutSeconds', 'Function timeout', 30, 's', 1, 900),
    count('reservedConcurrency', 'Reserved concurrency', 10),
    text('trigger', 'Trigger description', 'Not yet linked'),
    boolean('healthChecks', 'Health monitoring', true),
  ],
  'lambda',
  ['aws', 'function', 'serverless'],
  'Amazon Web Services',
);
for (const [id, name, provider] of [
  ['s3', 'Amazon S3', 'Amazon Web Services'],
  ['gcs', 'Google Cloud Storage', 'Google Cloud'],
  ['azureblob', 'Azure Blob Storage', 'Microsoft Azure'],
] as const)
  add(
    id,
    name,
    'storage',
    'database',
    'Object storage',
    `${name} object storage and lifecycle declarations.`,
    [
      text('region', 'Provider region', 'Declared'),
      text('containerName', 'Bucket or container name', 'architecture-objects'),
      choice(
        'storageClass',
        'Storage tier',
        id === 'azureblob' ? 'Hot' : 'Standard',
        id === 's3'
          ? [
              'Standard',
              'Standard-IA',
              'One Zone-IA',
              'Intelligent-Tiering',
              'Glacier Instant Retrieval',
              'Glacier Flexible Retrieval',
              'Glacier Deep Archive',
            ]
          : id === 'gcs'
            ? ['Standard', 'Nearline', 'Coldline', 'Archive']
            : ['Hot', 'Cool', 'Cold', 'Archive'],
      ),
      ...store,
    ],
    id,
    ['object', 'bucket', 'storage'],
    provider,
  );
for (const [id, name] of [
  ['elasticsearch', 'Elasticsearch'],
  ['opensearch', 'OpenSearch'],
  ['clickhouse', 'ClickHouse'],
  ['snowflake', 'Snowflake'],
] as const)
  add(
    id,
    name,
    'search',
    'database',
    'Search & analytics',
    `${name} indexed data and analytical workload declarations.`,
    [...db, text('workload', 'Query workload', 'Declared')],
    id,
    ['search', 'analytics', 'index'],
    id === 'snowflake' ? 'Snowflake' : undefined,
  );
for (const [id, name, sub, base] of [
  ['kubernetes', 'Kubernetes', 'Orchestration', 'boundary'],
  ['docker', 'Docker', 'Containers', 'service'],
  ['prometheus', 'Prometheus', 'Metrics', 'service'],
  ['grafana', 'Grafana', 'Visualization', 'service'],
  ['opentelemetry', 'OpenTelemetry', 'Telemetry', 'service'],
] as const)
  add(
    id,
    name,
    'observability',
    base,
    sub,
    `${name} infrastructure with declared deployment context.`,
    base === 'boundary'
      ? [
          ...constructs,
          count('controlPlaneNodes', 'Control plane nodes', 3),
          count('workerNodes', 'Worker nodes', 3),
        ]
      : [
          ...deployment,
          text('version', 'Software version', 'Declared'),
          text('purpose', 'Purpose', sub),
        ],
    id,
    ['monitoring', 'infrastructure', sub],
  );
const generics: [
  string,
  string,
  Group,
  string,
  string,
  ConfigurationField[],
][] = [
  [
    'browser',
    'Browser',
    'clients',
    'client',
    'A browser application.',
    [text('platform', 'Platform', 'Web')],
  ],
  [
    'mobile',
    'Mobile client',
    'clients',
    'client',
    'A mobile application.',
    [text('platform', 'Platform', 'Mobile')],
  ],
  [
    'desktop',
    'Desktop client',
    'clients',
    'client',
    'A desktop application.',
    [text('platform', 'Platform', 'Desktop')],
  ],
  [
    'external-service',
    'External service',
    'clients',
    'client',
    'An external request origin.',
    [text('platform', 'Platform', 'External')],
  ],
  [
    'api-consumer',
    'API consumer',
    'clients',
    'client',
    'A machine API client.',
    [text('platform', 'Platform', 'API')],
  ],
  ...['DNS', 'CDN', 'Reverse proxy', 'API gateway', 'Load balancer', 'WAF'].map(
    (name) =>
      [
        name.toLowerCase().replaceAll(' ', '-'),
        name,
        'networking',
        'load-balancer',
        `Vendor-independent ${name.toLowerCase()}.`,
        proxy,
      ] as (typeof generics)[number],
  ),
  ...[
    'Application server',
    'Container',
    'Kubernetes service',
    'Serverless function',
    'Virtual machine',
  ].map(
    (name) =>
      [
        name.toLowerCase().replaceAll(' ', '-'),
        name,
        'compute',
        'service',
        `Vendor-independent ${name.toLowerCase()}.`,
        deployment,
      ] as (typeof generics)[number],
  ),
  ...['Object storage', 'Block storage', 'File storage'].map(
    (name) =>
      [
        name.toLowerCase().replaceAll(' ', '-'),
        name,
        'storage',
        'database',
        `Vendor-independent ${name.toLowerCase()}.`,
        store,
      ] as (typeof generics)[number],
  ),
  ...[
    'Region',
    'Availability zone',
    'VPC',
    'Network boundary',
    'Trust boundary',
    'Service group',
  ].map(
    (name) =>
      [
        name.toLowerCase().replaceAll(' ', '-'),
        name,
        'constructs',
        'boundary',
        `${name} containment and deployment context.`,
        [
          ...constructs,
          choice(
            'kind',
            'Boundary type',
            name === 'Trust boundary'
              ? 'Trust'
              : name === 'Network boundary' || name === 'VPC'
                ? 'Network'
                : 'Deployment',
            ['Deployment', 'Network', 'Trust'],
          ),
        ],
      ] as (typeof generics)[number],
  ),
  [
    'external-dependency',
    'External dependency',
    'constructs',
    'service',
    'An explicitly unmodeled external dependency.',
    [text('purpose', 'Purpose', 'External dependency')],
  ],
];
for (const [id, name, group, base, description, fields] of generics) {
  add(
    `generic.${id}`,
    name,
    group,
    base,
    'Generic primitive',
    description,
    fields,
    base,
  );
  entries.at(-1)!.catalog!.identity = { kind: 'generic' };
  if (id === 'external-dependency')
    entries.at(-1)!.catalog!.capacityModel = 'unmodeled';
}
export const infrastructureComponents = entries;
export const defaultComponents = [
  ...infrastructureComponents,
  ...coreComponents,
];
export function categoryOf(c: ComponentDefinition): Group {
  return (
    c.catalog?.category ??
    (
      {
        client: 'clients',
        compute: 'compute',
        database: 'databases',
        cache: 'caching',
        messaging: 'messaging',
        boundary: 'constructs',
      } as const
    )[c.category]
  );
}
export function searchComponents(
  definitions: ComponentDefinition[],
  query: string,
) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return definitions.filter((c) =>
    words.every((word) =>
      [
        c.name,
        c.description,
        c.category,
        categoryOf(c),
        ...c.tags,
        ...c.capabilities,
        ...(c.catalog?.aliases ?? []),
        c.catalog?.subcategory ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(word),
    ),
  );
}
export const ComponentPackSchema = z.object({
  format: z.literal('swiftbuild-component-pack'),
  packVersion: z.literal('1.0'),
  id: z.string().min(1).max(128),
  name: z.string().min(1),
  version: z.string().min(1),
  license: z.string().min(1),
  components: z.array(ComponentDefinitionSchema).min(1).max(500),
});
export function loadPack(input: unknown) {
  const pack = ComponentPackSchema.parse(input),
    ids = new Set<string>();
  for (const c of pack.components) {
    if (ids.has(c.id)) throw new Error(`Duplicate component ${c.id}.`);
    ids.add(c.id);
    if (!c.catalog)
      throw new Error(`${c.name} needs a versioned catalog contract.`);
    const fields = new Set(c.configurationSchema.map((f) => f.key));
    if (
      fields.size !== c.configurationSchema.length ||
      new Set(c.ports.map((p) => p.id)).size !== c.ports.length
    )
      throw new Error(`${c.name} has duplicate fields or ports.`);
    const errors = configurationErrors(
      c,
      Object.fromEntries(c.configurationSchema.map((f) => [f.key, f.default])),
    );
    for (const binding of Object.values(c.catalog.resourceBindings))
      if (!fields.has(binding.field))
        errors.push(`Unknown resource field ${binding.field}.`);
    for (const rule of c.validationRules ?? [])
      if (!fields.has(rule.field) || !fields.has(rule.limitField))
        errors.push('A validation rule refers to an unknown field.');
    if (errors.length) throw new Error(`${c.name}: ${errors.join(' ')}`);
  }
  return pack;
}
export function legacyMapping(
  document: ArchitectureDocument,
  nodeId: string,
): ComponentDefinition | undefined {
  const n = document.nodes.find((n) => n.id === nodeId),
    old = document.components.find((c) => c.id === n?.componentId);
  if (!n || old?.id !== 'core.database' || old.version !== '1.0.0') return;
  const match = infrastructureComponents.find(
    (c) =>
      c.name === n.configuration.engine && c.catalog?.category === 'databases',
  );
  const baseline = coreComponents.find((c) => c.id === 'core.database')!;
  if (
    !match ||
    old.category !== baseline.category ||
    JSON.stringify(old.constraints) !== JSON.stringify(baseline.constraints) ||
    JSON.stringify(old.capabilities) !==
      JSON.stringify(baseline.capabilities) ||
    JSON.stringify(old.ports) !== JSON.stringify(baseline.ports) ||
    JSON.stringify(old.configurationSchema) !==
      JSON.stringify(baseline.configurationSchema)
  )
    return;
  return match;
}
export function upgradeLegacyNode(
  document: ArchitectureDocument,
  nodeId: string,
) {
  const next = structuredClone(document),
    target = legacyMapping(next, nodeId);
  if (!target)
    throw new Error(
      'No unambiguous lossless technology mapping is available. Retain this embedded definition.',
    );
  const n = next.nodes.find((n) => n.id === nodeId)!;
  const installed = next.components.find((c) => c.id === target.id);
  if (installed && JSON.stringify(installed) !== JSON.stringify(target))
    throw new Error(
      'The target definition differs from the installed version. Resolve the definition upgrade explicitly.',
    );
  if (!next.components.some((c) => c.id === target.id))
    next.components.push(structuredClone(target));
  n.componentId = target.id;
  n.componentVersion = target.version;
  n.configuration = {
    ...Object.fromEntries(
      target.configurationSchema.map((f) => [f.key, f.default]),
    ),
    ...n.configuration,
  };
  return next;
}
loadPack({
  format: 'swiftbuild-component-pack',
  packVersion: '1.0',
  id: 'swiftbuild.infrastructure',
  name: 'Infrastructure',
  version: '1.0.0',
  license: 'Apache-2.0',
  components: infrastructureComponents,
});

export function infrastructureSampleDocument(): ArchitectureDocument {
  const d = upgradeLegacyNode(sampleDocument(), 'database');
  const byName = (name: string) =>
    infrastructureComponents.find((c) => c.name === name)!;
  const configure = (
    nodeId: string,
    definition: ComponentDefinition,
    name: string,
  ) => {
    const n = d.nodes.find((n) => n.id === nodeId)!;
    if (!d.components.some((c) => c.id === definition.id))
      d.components.push(structuredClone(definition));
    n.componentId = definition.id;
    n.componentVersion = definition.version;
    n.name = name;
    n.configuration = Object.fromEntries(
      definition.configurationSchema.map((f) => [f.key, f.default]),
    );
  };
  configure('client', byName('Browser'), 'Web application');
  configure('service', byName('Application server'), 'Commerce API');
  configure('cache', byName('Redis'), 'Redis Cache');
  d.nodes.find((n) => n.id === 'service')!.configuration.replicas = 3;
  d.nodes.find((n) => n.id === 'database')!.name = 'PostgreSQL';
  for (const [id, name, definitionName, x, y] of [
    ['gateway', 'NGINX', 'NGINX', 310, 80],
    ['orders', 'Order Queue', 'Apache Kafka', 700, 520],
    ['worker', 'Order Worker', 'Worker', 1040, 520],
  ] as const) {
    const definition =
      definitionName === 'Worker'
        ? coreComponents.find((c) => c.id === 'core.worker')!
        : byName(definitionName);
    if (!d.components.some((c) => c.id === definition.id))
      d.components.push(structuredClone(definition));
    d.nodes.push({
      id,
      name,
      componentId: definition.id,
      componentVersion: definition.version,
      configuration: Object.fromEntries(
        definition.configurationSchema.map((f) => [f.key, f.default]),
      ),
      metadata: {},
    });
    d.views[0]!.nodeIds.push(id);
    d.views[0]!.layout[id] = { x, y };
  }
  d.views[0]!.layout.client = { x: 20, y: 80 };
  d.views[0]!.layout.service = { x: 620, y: 80 };
  d.views[0]!.layout.cache = { x: 620, y: 300 };
  d.views[0]!.layout.database = { x: 960, y: 80 };
  d.edges.find((e) => e.relationship === 'request')!.target.nodeId = 'gateway';
  d.edges.push(
    {
      id: 'gateway-api',
      source: { nodeId: 'gateway', portId: 'out' },
      target: { nodeId: 'service', portId: 'in' },
      relationship: 'request',
      label: 'HTTPS',
      metadata: {},
    },
    {
      id: 'produce',
      source: { nodeId: 'service', portId: 'out' },
      target: { nodeId: 'orders', portId: 'in' },
      relationship: 'async-message',
      label: 'Publish orders',
      metadata: {},
    },
    {
      id: 'consume',
      source: { nodeId: 'orders', portId: 'out' },
      target: { nodeId: 'worker', portId: 'in' },
      relationship: 'async-message',
      label: 'Consume',
      metadata: {},
    },
  );
  d.architecture.name = 'Commerce infrastructure';
  return d;
}
