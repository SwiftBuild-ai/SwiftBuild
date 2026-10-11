import { it, expect } from 'vitest';
import { fixture } from './fixture.test.data';
import { estimateScenario, simulateTopology } from './index';
it('does not replace missing payload and storage sizing with fabricated zeroes', async () => {
  const d = fixture(),
    t = d.scenarios[0]!.trafficClasses[0]!;
  delete t.payloadBytes;
  delete t.responseBytes;
  delete t.objectBytes;
  delete t.retentionDays;
  const estimate = estimateScenario(d, 's');
  expect(estimate.metrics.find((m) => m.id === 't:bandwidth')!.status).toBe(
    'unknown',
  );
  expect(estimate.metrics.find((m) => m.id === 't:storage')!.status).toBe(
    'unknown',
  );
  d.flowPolicies[0]!.linkBytesPerSecond = 1000;
  expect(
    (await simulateTopology(d, 's')).coverage.some((c) =>
      c.message.includes('payload sizes'),
    ),
  ).toBe(true);
});
