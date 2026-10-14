import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const scanner = fileURLToPath(new URL('./docs-links.mjs', import.meta.url));
async function fixture(t, readme) {
  const root = await mkdtemp(join(tmpdir(), 'swiftbuild-doc-links-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'docs'));
  await writeFile(join(root, 'docs', 'With spaces.md'), '# Example');
  await writeFile(join(root, 'logo.svg'), '<svg/>');
  await writeFile(join(root, 'README.md'), readme);
  await writeFile(join(root, 'CHANGELOG.md'), '[Old](removed.md)');
  await writeFile(join(root, 'NOTICE.md'), '[Attribution](missing-license.md)');
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  return spawnSync(process.execPath, [scanner], {
    cwd: root,
    encoding: 'utf8',
  });
}
test('checks local images, encoded paths, spaces, fragments and directories without fetching external links', async (t) => {
  const result = await fixture(
    t,
    `
![Logo](logo.svg)
<img alt="Logo" src="logo.svg">
<img src='logo.svg'>
[Encoded](docs/With%20spaces.md#unverified-anchor)
[Spaces](<docs/With spaces.md>)
[Directory](docs/)
[Reference][guide]
[guide]: <docs/With spaces.md> "Guide"
[External](https://example.invalid/not-fetched)
[Protocol-relative](//example.invalid/not-fetched)
[Anchor](#unverified)
<!-- [Hidden](missing.md) -->
\`[Code](missing.md)\`
\`\`\`md
[Fenced](missing.md)
\`\`\`
`,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /anchors not checked/);
});
test('reports missing inline, reference and HTML image targets with the source file', async (t) => {
  const result = await fixture(
    t,
    `[Broken](docs/missing.md#section)
[reference]: docs/missing-reference.md
<img src="missing.svg">
[Invalid](docs/%ZZ.md)
`,
  );
  assert.equal(result.status, 1, result.stdout);
  for (const target of [
    'docs/missing.md#section',
    'docs/missing-reference.md',
    'missing.svg',
    'docs/%ZZ.md',
  ])
    assert.ok(
      result.stderr.includes(
        `README.md: missing or invalid local target ${target}`,
      ),
      result.stderr,
    );
});
