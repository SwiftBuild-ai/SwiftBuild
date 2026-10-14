import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scanner = fileURLToPath(new URL('./boundaries.mjs', import.meta.url));
async function fixture(t, source, owner = 'architecture-schema') {
  const root = await mkdtemp(join(tmpdir(), 'swiftbuild-boundaries-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of await readdir(
    new URL('../../packages/', import.meta.url),
  )) {
    await mkdir(join(root, 'packages', name, 'src'), { recursive: true });
    await writeFile(
      join(root, 'packages', name, 'package.json'),
      JSON.stringify({ dependencies: {} }),
    );
  }
  await writeFile(join(root, 'packages', owner, 'src', 'probe.ts'), source);
  return spawnSync(process.execPath, [scanner], {
    cwd: root,
    encoding: 'utf8',
  });
}
for (const source of [
  "import '@swiftbuild/server-core';",
  "import type { Actor } from '@swiftbuild/server-core';",
  "export { createProjectStore } from '@swiftbuild/server-core';",
  "export type { Actor } from '@swiftbuild/server-core';",
  "void import('@swiftbuild/server-core');",
  'void import(`@swiftbuild/server-core`);',
  "void import('../../server-core/src/index');",
  "void import('..\\\\..\\\\server-core\\\\src\\\\index');",
  "import '../../../apps/web/client/project-recovery';",
]) {
  test(`rejects a boundary bypass: ${source}`, async (t) => {
    const result = await fixture(t, source);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /probe\.ts/);
    assert.match(
      result.stderr,
      /forbidden dependency|use public package exports/,
    );
  });
}
test('permits public dependencies and package-local relatives without matching comments or strings', async (t) => {
  const result = await fixture(
    t,
    `
    import type { Document } from '@swiftbuild/architecture-schema';
    export { parseDocument } from '@swiftbuild/architecture-schema';
    import './local';
    void import('../src/local');
    // import '@swiftbuild/server-core';
    /* export * from '@swiftbuild/server-core'; */
    const text = "from '@swiftbuild/server-core'";
    const text2 = "import('@swiftbuild/server-core')";
  `,
    'architecture-model',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Package boundaries verified/);
});
