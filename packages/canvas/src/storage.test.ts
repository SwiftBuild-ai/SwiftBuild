import { it, expect } from 'vitest';
import { sampleDocument } from '@swiftbuild/components-core';
import { serializeDocument } from '@swiftbuild/architecture-schema';
import { importDocument, MAX_IMPORT_BYTES } from './storage';
it('round-trips native JSON with metadata and stable IDs', () => {
  const d = sampleDocument();
  d.metadata = { extension: { retained: true } };
  const raw = serializeDocument(d);
  expect(importDocument(raw, raw.length)).toEqual(d);
});
it('rejects invalid imports without modifying current work', () => {
  const current = sampleDocument(),
    original = JSON.stringify(current);
  const invalid = structuredClone(current);
  invalid.nodes[1]!.configuration.replicas = 0;
  expect(() => importDocument(JSON.stringify(invalid), 1)).toThrow('Replicas');
  expect(() => importDocument('{bad', 4)).toThrow();
  expect(JSON.stringify(current)).toBe(original);
});
it('checks both declared and actual native-file sizes', () => {
  expect(() => importDocument('{}', MAX_IMPORT_BYTES + 1)).toThrow('5 MB');
  expect(() => importDocument(' '.repeat(MAX_IMPORT_BYTES + 1), 1)).toThrow(
    '5 MB',
  );
});
