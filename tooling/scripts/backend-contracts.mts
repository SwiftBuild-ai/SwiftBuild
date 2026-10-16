/** Build-time compatibility exports. The Python runtime never imports Node. */
import { createHash, scryptSync } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { z } from '../../packages/server-core/node_modules/zod';
import { ArchitectureDocumentSchema } from '../../packages/architecture-schema/src/index';
import {
  FlowPolicySchema,
  PerformanceProfileSchema,
} from '../../packages/architecture-schema/src/index';
import { sampleDocument } from '../../packages/components-core/src/index';
import { validateDocument } from '../../packages/graph-engine/src/index';
import {
  ProjectArchiveSchema,
  validateArchive,
  workspaceFor,
} from '../../packages/project-format/src/index';
import { migrations } from '../../packages/server-core/src/migrate';
import { randomFor } from '../../packages/capacity-engine/src/random';
import {
  fixture,
  queueFixture,
} from '../../packages/capacity-engine/src/fixture.test.data';
import {
  analyzeTopology,
  simulateTopology,
} from '../../packages/capacity-engine/src/index';
import {
  canonicalJson,
  AnalysisDefinitionSchema,
  ExecutionInputSchema,
  ComputationReportSchema,
  AnalysisBundleSchema,
} from '../../packages/computation-contracts/src/index';
import {
  verifyPassword,
  symmetricEncrypt,
  symmetricDecrypt,
} from '../../packages/server-core/node_modules/better-auth/dist/crypto/index.mjs';

const root = new URL('../../services/backend/', import.meta.url);
const checking = process.argv.includes('--check');
async function output(path: string, value: unknown) {
  const target = new URL(path, root);
  const text = JSON.stringify(value, null, 2) + '\n';
  if (checking) {
    if ((await readFile(target, 'utf8')) !== text)
      throw new Error(`Backend compatibility drift: ${path}`);
  } else {
    await mkdir(new URL('.', target), { recursive: true });
    await writeFile(target, text);
  }
}
await output(
  'tests/fixtures/emails.json',
  [
    'Owner@Example.Test',
    'a+b@example.test',
    "a'b@example.test",
    '.a@example.test',
    'a..b@example.test',
    'a.@example.test',
    'a!b@example.test',
    'a@-example.test',
    'a@example-.test',
    'café@example.test',
    'a@localhost',
    'a_b@example.test',
  ].map((value) => ({ value, valid: z.email().safeParse(value).success })),
);
await output('swiftbuild_backend/contracts/computation.json', {
  schemaDigest: createHash('sha256')
    .update(
      await readFile(
        new URL('../../services/computation/contracts.json', import.meta.url),
      ),
    )
    .digest('hex'),
});
await output(
  'tests/fixtures/names.json',
  [
    ' Workspace ',
    '\uFEFF Workspace \uFEFF',
    '\u0085Workspace\u0085',
    '\uFEFF',
    '\u0085',
    ' '.repeat(120) + 'Workspace' + ' '.repeat(120),
    '😀'.repeat(60),
    '😀'.repeat(61),
    'a'.repeat(120),
    'a'.repeat(121),
  ].map((value) => {
    const parsed = z.string().trim().min(1).max(120).safeParse(value);
    return parsed.success
      ? { value, valid: true, output: parsed.data }
      : { value, valid: false };
  }),
);
await output(
  'swiftbuild_backend/contracts/schemas.json',
  Object.fromEntries(
    Object.entries({
      ArchitectureDocument: ArchitectureDocumentSchema,
      ProjectArchive: ProjectArchiveSchema,
      AnalysisDefinition: AnalysisDefinitionSchema,
      ExecutionInput: ExecutionInputSchema,
      ComputationReport: ComputationReportSchema,
      AnalysisBundle: AnalysisBundleSchema,
    }).map(([name, schema]) => [name, z.toJSONSchema(schema, { io: 'input' })]),
  ),
);
await output(
  'swiftbuild_backend/contracts/migrations.json',
  migrations.map((m) => ({
    ...m,
    checksum: createHash('sha256').update(m.sql).digest('hex'),
  })),
);

const base = sampleDocument();
base.project.id = 'compatibility-project';
base.architecture.id = 'compatibility-architecture';
base.metadata = {
  purpose: 'Synthetic compatibility fixture',
  nested: { '10': 10, '2': 2, unicode: '𝄞 café' },
};
const documents: Array<{ name: string; input: unknown }> = [
  { name: 'native-1.1', input: base },
  { name: 'native-1.0', input: { ...base, schemaVersion: '1.0' } },
];
for (const [name, mutate] of Object.entries({
  duplicateNode: (d: typeof base) => d.nodes.push(structuredClone(d.nodes[0]!)),
  missingComponent: (d: typeof base) => {
    d.nodes[0]!.componentId = 'absent';
  },
  missingPort: (d: typeof base) => {
    d.edges[0]!.target.portId = 'absent';
  },
  missingLayout: (d: typeof base) => {
    delete d.views[0]!.layout[d.views[0]!.nodeIds[0]!];
  },
  invalidConfiguration: (d: typeof base) => {
    d.nodes[1]!.configuration = {};
  },
  unicodeNameWithinLimit: (d: typeof base) => {
    d.project.name = '😀'.repeat(120);
  },
  unicodeNameExceedsLimit: (d: typeof base) => {
    d.project.name = '😀'.repeat(121);
  },
  unsupportedVersion: (d: typeof base) => {
    (d as unknown as { schemaVersion: string }).schemaVersion = '9.0';
  },
})) {
  const d = structuredClone(base);
  mutate(d);
  documents.push({ name, input: d });
}
await output(
  'tests/fixtures/documents.json',
  documents.map(({ name, input }) => {
    try {
      return { name, input, output: validateDocument(input), valid: true };
    } catch {
      return { name, input, valid: false };
    }
  }),
);
const archive = workspaceFor(base);
archive.exportedAt = '2026-10-15T00:00:00Z';
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, x]) => [k, canonical(x)]),
        )
      : v;
const { exportedAt: _time, ...persistent } = validateArchive(archive);
await output('tests/fixtures/archive.json', {
  archive,
  digest: createHash('sha256')
    .update(JSON.stringify(canonical(persistent)))
    .digest('hex'),
});
const values = [
  null,
  true,
  1,
  1e-7,
  1e20,
  1e21,
  -0,
  '𝄞 café',
  '\ud800',
  { '10': 10, '2': 2, z: 0, a: 1 },
  { '𝄞': 1, '\uffff': 2 },
];
await output(
  'tests/fixtures/serialization.json',
  values.map((value) => ({ value, json: JSON.stringify(canonical(value)) })),
);
await output(
  'tests/fixtures/random.json',
  [0, 1, 42, 4294967295, -1].flatMap((seed) =>
    [0, 1, 2, 50].map((stream) => {
      const rng = randomFor(seed, stream);
      return { seed, stream, values: Array.from({ length: 12 }, () => rng()) };
    }),
  ),
);
const cases: Array<[string, ReturnType<typeof fixture>]> = [
  ['service', fixture()],
  ['queue', queueFixture()],
];
for (const [name, mutate] of Object.entries({
  poisson: (d: ReturnType<typeof fixture>) => {
    d.scenarios[0]!.trafficClasses[0]!.arrivals = 'poisson';
    d.performanceProfiles[0]!.serviceTime = { kind: 'exponential', meanMs: 20 };
  },
  overload: (d: ReturnType<typeof fixture>) => {
    d.scenarios[0]!.trafficClasses[0]!.workload = {
      kind: 'rate',
      requestsPerSecond: 100,
    };
  },
  cpu: (d: ReturnType<typeof fixture>) => {
    Object.assign(d.performanceProfiles[0]!, {
      cpuCores: 0.5,
      cpuSecondsPerOperation: 0.03,
      serviceTimeScope: 'non-cpu',
    });
  },
  memory: (d: ReturnType<typeof fixture>) => {
    Object.assign(d.performanceProfiles[0]!, {
      concurrency: 4,
      memoryBytesPerOperation: 100,
      memoryBytes: 200,
    });
  },
  readReplicas: (d: ReturnType<typeof fixture>) => {
    Object.assign(d.performanceProfiles[0]!, {
      model: 'database',
      readReplicas: 2,
    });
  },
  empirical: (d: ReturnType<typeof fixture>) => {
    d.performanceProfiles[0]!.serviceTime = {
      kind: 'empirical',
      samplesMs: [40, 10, 20],
    };
  },
  retries: (d: ReturnType<typeof fixture>) => {
    Object.assign(d.flowPolicies[0]!, {
      retryProbability: 0.4,
      maxRetries: 2,
      retryBackoffMs: 2,
      timeoutMs: 10,
    });
  },
  link: (d: ReturnType<typeof fixture>) => {
    Object.assign(d.flowPolicies[0]!, {
      linkBytesPerSecond: 2000,
      networkLatencyMs: 3,
    });
  },
  bursts: (d: ReturnType<typeof fixture>) => {
    d.scenarios[0]!.trafficClasses[0]!.bursts = [
      { startSeconds: 1, durationSeconds: 2, multiplier: 10 },
    ];
  },
  missingPolicy: (d: ReturnType<typeof fixture>) => {
    d.flowPolicies = [];
  },
  missingService: (d: ReturnType<typeof fixture>) => {
    delete d.performanceProfiles[0]!.serviceTime;
  },
  twoClasses: (d: ReturnType<typeof fixture>) => {
    d.scenarios[0]!.trafficClasses.push({
      ...structuredClone(d.scenarios[0]!.trafficClasses[0]!),
      id: 'second',
      name: 'Second traffic',
    });
  },
})) {
  const d = fixture();
  mutate(d);
  cases.push([name, d]);
}
for (const acknowledgement of ['on-admission', 'on-completion'] as const) {
  const d = queueFixture();
  Object.assign(d.performanceProfiles[0]!.queue!, {
    bufferMessages: 2,
    retentionSeconds: 0.01,
    acknowledgement,
  });
  cases.push(['queue-' + acknowledgement, d]);
}
const cache = sampleDocument();
cache.scenarios = fixture().scenarios;
cache.performanceProfiles = fixture().performanceProfiles;
for (const [id, model] of [
  ['cache', 'cache'],
  ['database', 'database'],
] as const)
  cache.performanceProfiles.push(
    PerformanceProfileSchema.parse({
      id: 'profile-' + id,
      nodeId: id,
      model,
      serviceTime: { kind: 'exponential', meanMs: 3 },
      cacheHitRatio: 0.8,
      provenance: fixture().performanceProfiles[0]!.provenance,
    }),
  );
cache.flowPolicies = cache.edges.map((e) =>
  FlowPolicySchema.parse({
    id: 'flow-' + e.id,
    edgeId: e.id,
    callsPerOperation: 1,
    assumption: 'Synthetic routing',
    ...(e.target.nodeId === 'database'
      ? { operation: 'cache-aside', cacheNodeId: 'cache' }
      : {}),
  }),
);
cases.push(['cache-aside', cache]);
const computations = [];
for (const [name, document] of cases) {
  document.engineering.simulation.durationSeconds = 5;
  document.engineering.simulation.warmupSeconds = 0;
  document.engineering.simulation.replications = 2;
  computations.push({
    name,
    document,
    analytical: analyzeTopology(document, 's'),
    simulation: await simulateTopology(document, 's'),
  });
}
await output('tests/fixtures/capacity.json', computations);
await output('tests/fixtures/provenance.json', {
  revision: 'e0897901bdf865b356f0a5406c147ba571436178',
  synthetic: true,
  computationCanonical: canonicalJson({ n: 1.0, text: 'café' }),
});
const passwords = [];
for (const password of [
  'synthetic ASCII password',
  'synthetic Å①Ｆ password',
]) {
  const salt = '0123456789abcdef0123456789abcdef';
  const hash =
    salt +
    ':' +
    scryptSync(password.normalize('NFKC'), salt, 64, {
      N: 16384,
      r: 16,
      p: 1,
      maxmem: 67108864,
    }).toString('hex');
  if (!(await verifyPassword({ hash, password })))
    throw new Error('Installed password compatibility changed.');
  passwords.push({ password, hash });
}
await output('tests/fixtures/passwords.json', passwords);
const secret = 'synthetic-token-encryption-secret-'.repeat(3),
  token = 'synthetic-provider-token';
let encrypted: string;
try {
  encrypted = JSON.parse(
    await readFile(new URL('tests/fixtures/encryption.json', root), 'utf8'),
  ).ciphertext;
} catch {
  if (checking) throw new Error('Missing encryption fixture.');
  encrypted = await symmetricEncrypt({ key: secret, data: token });
}
if ((await symmetricDecrypt({ key: secret, data: encrypted })) !== token)
  throw new Error('Installed token encryption compatibility changed.');
await output('tests/fixtures/encryption.json', {
  secret,
  token,
  ciphertext: encrypted,
});
