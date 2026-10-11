import { it, expect } from 'vitest';
import { cpus, platform, release, totalmem } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { fixture } from './fixture.test.data';
import { analyzeTopology, simulateTopology } from './index';
it('benchmarks a 1,000-node parallel topology with bounded execution', async () => {
  const d = fixture();
  const baseNode = structuredClone(d.nodes[1]!),
    baseEdge = structuredClone(d.edges[0]!),
    baseProfile = structuredClone(d.performanceProfiles[0]!),
    basePolicy = structuredClone(d.flowPolicies[0]!);
  d.nodes = [d.nodes[0]!];
  d.edges = [];
  d.performanceProfiles = [];
  d.flowPolicies = [];
  d.views[0]!.nodeIds = ['client'];
  d.views[0]!.layout = { client: { x: 0, y: 0 } };
  for (let i = 0; i < 999; i++) {
    const id = `node-${String(i).padStart(4, '0')}`,
      edgeId = `edge-${i}`;
    d.nodes.push({ ...baseNode, id });
    d.edges.push({
      ...baseEdge,
      id: edgeId,
      target: { nodeId: id, portId: 'in' },
    });
    d.performanceProfiles.push({
      ...baseProfile,
      id: `profile-${i}`,
      nodeId: id,
    });
    d.flowPolicies.push({
      ...basePolicy,
      id: `policy-${i}`,
      edgeId,
      execution: 'parallel',
    });
    d.views[0]!.nodeIds.push(id);
    d.views[0]!.layout[id] = { x: (i % 40) * 300, y: Math.floor(i / 40) * 200 };
  }
  const memoryBefore = process.memoryUsage().heapUsed,
    start = performance.now();
  const analytical = analyzeTopology(d, 's');
  const analyticalMs = performance.now() - start;
  const simulationStart = performance.now();
  const simulation = await simulateTopology(d, 's', {
    warmupSeconds: 0,
    durationSeconds: 1,
    replications: 1,
    maxEvents: 100000,
    maxWallTimeMs: 10000,
  });
  const simulationMs = performance.now() - simulationStart;
  expect(analytical.nodes).toHaveLength(1000);
  expect(simulation.status).toBe('complete');
  expect((await simulateTopology(d, 's', { maxEvents: 2 })).status).toBe(
    'partial',
  );
  expect(
    (await simulateTopology(d, 's', { shouldCancel: () => true })).status,
  ).toBe('cancelled');
  const measurements = {
    measuredAt: new Date().toISOString(),
    node: process.version,
    platform: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    ramBytes: totalmem(),
    nodes: 1000,
    analyticalMs,
    simulationMs,
    processedEvents: simulation.processedEvents,
    heapDeltaBytes: process.memoryUsage().heapUsed - memoryBefore,
    simulationStatus: simulation.status,
  };
  await mkdir('.agent-work', { recursive: true });
  await writeFile(
    '.agent-work/capacity-benchmark.json',
    JSON.stringify(measurements, null, 2),
  );
}, 20000);
