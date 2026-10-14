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
it('rejects an underreported multibyte native import by its UTF-8 byte count', () => {
  const document = sampleDocument();
  document.metadata = {
    description: '\u754c'.repeat(Math.ceil(MAX_IMPORT_BYTES / 3)),
  };
  const raw = serializeDocument(document);
  expect(raw.length).toBeLessThan(MAX_IMPORT_BYTES);
  expect(new TextEncoder().encode(raw).length).toBeGreaterThan(
    MAX_IMPORT_BYTES,
  );
  expect(() => importDocument(raw, 1)).toThrow('5 MB');
});
it('round-trips small non-ASCII text and stable IDs', () => {
  const document = sampleDocument();
  document.nodes[0]!.name = 'Architecture \u754c \u00e9';
  document.metadata = {
    description: '\u0938\u094d\u0935\u093f\u092b\u094d\u091f \u{1F680}',
  };
  const raw = serializeDocument(document);
  expect(importDocument(raw, new TextEncoder().encode(raw).length)).toEqual(
    document,
  );
});
