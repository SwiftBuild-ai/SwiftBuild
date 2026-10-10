import { it, expect } from 'vitest';
import { sampleDocument } from '@swiftbuild/components-core';
import {
  loadDraft,
  saveDraft,
  importDocument,
  MAX_IMPORT_BYTES,
} from './storage';
it('saves and restores a validated draft', () => {
  let raw: string | null = null;
  const storage = {
    read: () => raw,
    write: (v: string) => {
      raw = v;
    },
  };
  expect(loadDraft(storage).status).toBe('empty');
  saveDraft(storage, sampleDocument());
  expect(loadDraft(storage)).toEqual({
    status: 'loaded',
    document: sampleDocument(),
  });
});
it('reports corrupt or unavailable storage without overwriting', () => {
  let writes = 0;
  const storage = {
    read: () => '{bad',
    write: () => {
      writes++;
    },
  };
  expect(loadDraft(storage).status).toBe('error');
  expect(writes).toBe(0);
  expect(
    loadDraft({
      read: () => {
        throw new Error('Denied');
      },
      write: () => {},
    }),
  ).toEqual({ status: 'error', message: 'Denied' });
});
it('surfaces quota failures and rejects oversized or invalid imports', () => {
  expect(() =>
    saveDraft(
      {
        read: () => null,
        write: () => {
          throw new Error('Quota');
        },
      },
      sampleDocument(),
    ),
  ).toThrow('Quota');
  expect(() => importDocument('{}', MAX_IMPORT_BYTES + 1)).toThrow('5 MB');
  expect(() => importDocument('{bad', 4)).toThrow();
});
