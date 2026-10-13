import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { canonicalJson, ExecutionRequestSchema } from './index';
const fixture = JSON.parse(
  readFileSync(
    new URL('../../../services/computation/fixtures.json', import.meta.url),
    'utf8',
  ),
) as {
  canonical: { input: unknown; digest: string }[];
  accepted: unknown[];
  rejected: unknown[];
};
it('matches Python canonical bytes and accepted/rejected schema fixtures', () => {
  for (const c of fixture.canonical)
    expect(
      createHash('sha256').update(canonicalJson(c.input)).digest('hex'),
    ).toBe(c.digest);
  for (const c of fixture.accepted)
    expect(ExecutionRequestSchema.safeParse(c).success).toBe(true);
  for (const c of fixture.rejected)
    expect(ExecutionRequestSchema.safeParse(c).success).toBe(false);
});
it('rejects non-finite computation values', () => {
  expect(() => canonicalJson({ value: Infinity })).toThrow();
  expect(() => canonicalJson({ value: '\ud800' })).toThrow();
});
