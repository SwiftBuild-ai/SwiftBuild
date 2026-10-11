import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const allowed = {
  'architecture-schema': [],
  'architecture-model': ['architecture-schema'],
  'graph-engine': ['architecture-schema', 'architecture-model'],
  'components-core': ['architecture-schema'],
  'component-registry': ['architecture-schema', 'components-core'],
  'capacity-engine': [
    'architecture-schema',
    'architecture-model',
    'graph-engine',
  ],
  'rule-engine': [
    'architecture-schema',
    'architecture-model',
    'graph-engine',
    'capacity-engine',
  ],
  'design-tokens': [],
  ui: ['design-tokens'],
  canvas: [
    'architecture-schema',
    'architecture-model',
    'graph-engine',
    'components-core',
    'component-registry',
    'capacity-engine',
    'rule-engine',
    'ui',
    'design-tokens',
  ],
};
let failed = false;
async function visit(dir, owner) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (
      ['node_modules', 'dist', '.next', 'storybook-static'].includes(entry.name)
    )
      continue;
    if (entry.isDirectory()) {
      await visit(path, owner);
      continue;
    }
    if (!/\.[cm]?[jt]sx?$/.test(entry.name) || entry.name.includes('.test.'))
      continue;
    const source = await readFile(path, 'utf8');
    for (const match of source.matchAll(
      /(?:from\s*|import\s*\()(['"])([^'"]+)\1/g,
    )) {
      const target = match[2];
      if (
        target.startsWith('@swiftbuild/') &&
        !allowed[owner].includes(target.split('/')[1])
      ) {
        console.error(`${path}: forbidden dependency ${target}`);
        failed = true;
      }
      if (
        target.includes('apps/') ||
        /^(\.\.\/){2,}.*packages\//.test(target)
      ) {
        console.error(`${path}: use public package exports`);
        failed = true;
      }
    }
  }
}
for (const owner of Object.keys(allowed)) {
  const manifest = JSON.parse(
    await readFile(`packages/${owner}/package.json`, 'utf8'),
  );
  for (const name of Object.keys(manifest.dependencies ?? {}))
    if (
      name.startsWith('@swiftbuild/') &&
      !allowed[owner].includes(name.split('/')[1])
    ) {
      console.error(`${owner}: forbidden manifest dependency ${name}`);
      failed = true;
    }
  await visit(`packages/${owner}/src`, owner);
}
if (failed) process.exitCode = 1;
else console.log('Package boundaries verified.');
