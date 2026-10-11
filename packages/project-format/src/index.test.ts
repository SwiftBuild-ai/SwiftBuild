import { expect, it } from 'vitest';
import { blankDocument } from '@swiftbuild/components-core';
import { createCheckpoint } from '@swiftbuild/architecture-model';
import {
  importArchive,
  serializeArchive,
  validateArchive,
  workspaceFor,
  MAX_ARCHIVE_BYTES,
} from './index';

it('migrates every native boundary without mutating input or losing metadata', () => {
  const archive = workspaceFor(blankDocument());
  archive.document.metadata = { portable: { retained: true } };
  archive.checkpoints.push(
    createCheckpoint(
      archive.document,
      'Before',
      'first',
      '2026-10-12T00:00:00Z',
    ),
  );
  const input = JSON.parse(JSON.stringify(archive));
  input.document.schemaVersion = '1.0';
  input.checkpoints[0].document.schemaVersion = '1.0';
  const before = JSON.stringify(input);
  const result = validateArchive(input);
  expect(result.document.schemaVersion).toBe('1.1');
  expect(result.checkpoints[0]!.document.schemaVersion).toBe('1.1');
  expect(result.document.metadata).toEqual(archive.document.metadata);
  expect(result.document.project.id).toBe(archive.document.project.id);
  expect(JSON.stringify(input)).toBe(before);
});

it('rejects duplicate checkpoints and unsupported or structurally invalid documents', () => {
  const archive = workspaceFor(blankDocument());
  const checkpoint = createCheckpoint(
    archive.document,
    'Before',
    'first',
    '2026-10-12T00:00:00Z',
  );
  expect(() =>
    validateArchive({ ...archive, checkpoints: [checkpoint, checkpoint] }),
  ).toThrow('Duplicate');
  expect(() =>
    validateArchive({ ...archive, archiveVersion: '2.0' }),
  ).toThrow();
  expect(() =>
    validateArchive({
      ...archive,
      document: { ...archive.document, schemaVersion: '9.0' },
    }),
  ).toThrow();
  expect(() =>
    validateArchive({
      ...archive,
      document: { ...archive.document, views: [] },
    }),
  ).toThrow();
});

it('round-trips portable archives and rejects both declared and actual oversized imports', () => {
  const archive = workspaceFor(blankDocument());
  const raw = serializeArchive(archive);
  expect(importArchive(raw, new TextEncoder().encode(raw).length)).toEqual(
    archive,
  );
  expect(() => importArchive(raw, MAX_ARCHIVE_BYTES + 1)).toThrow('50 MB');
  expect(() => importArchive(' '.repeat(MAX_ARCHIVE_BYTES + 1), 1)).toThrow(
    '50 MB',
  );
});
