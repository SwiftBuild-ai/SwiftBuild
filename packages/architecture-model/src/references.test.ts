import { it, expect } from 'vitest';
import { engineeringSampleDocument } from '@swiftbuild/components-core';
import { deleteNodes, duplicateNodes } from './index';
it('removes incident engineering references while preserving remaining entity IDs', () => {
  const d = engineeringSampleDocument(),
    next = deleteNodes(d, ['cache']);
  expect(next.performanceProfiles.some((p) => p.nodeId === 'cache')).toBe(
    false,
  );
  expect(
    next.flowPolicies.some(
      (p) => p.cacheNodeId === 'cache' || p.edgeId === 'edge-cache',
    ),
  ).toBe(false);
  expect(next.requirements[0]!.id).toBe(d.requirements[0]!.id);
  expect(next.requirements[0]!.nodeIds).not.toContain('cache');
  expect(deleteNodes(d, ['client']).scenarios).toEqual([]);
});
it('copies profiles and internal policies to new stable references', () => {
  const d = engineeringSampleDocument();
  let sequence = 0;
  const result = duplicateNodes(
    d,
    ['service', 'database'],
    () => `copy-${sequence++}`,
  );
  const profile = result.document.performanceProfiles.find(
    (p) => p.nodeId === result.ids[0],
  );
  expect(profile).toBeDefined();
  expect(profile!.id).not.toBe('profile-service');
  const edge = result.document.edges.find(
    (e) =>
      e.source.nodeId === result.ids[0] && e.target.nodeId === result.ids[1],
  );
  expect(result.document.flowPolicies.some((p) => p.edgeId === edge!.id)).toBe(
    true,
  );
});
