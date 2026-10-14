import { readdir, readFile } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep, win32 } from 'node:path';
import ts from 'typescript';
const allowed = {
  'architecture-schema': [],
  'computation-contracts': ['architecture-schema'],
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
  'project-format': [
    'architecture-schema',
    'architecture-model',
    'graph-engine',
    'capacity-engine',
  ],
  'server-core': [
    'project-format',
    'computation-contracts',
    'architecture-schema',
    'capacity-engine',
    'graph-engine',
  ],
  'design-tokens': [],
  ui: ['design-tokens'],
  canvas: [
    'computation-contracts',
    'project-format',
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
function specifiers(source, path) {
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const targets = [];
  function visit(node) {
    let specifier;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      specifier = node.moduleSpecifier;
    else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    )
      specifier = node.moduleReference.expression;
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      specifier = node.argument.literal;
    else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    )
      specifier = node.arguments[0];
    if (
      specifier &&
      (ts.isStringLiteral(specifier) ||
        ts.isNoSubstitutionTemplateLiteral(specifier))
    )
      targets.push(specifier.text);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return targets;
}
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
    for (const target of specifiers(source, path)) {
      if (
        target.startsWith('@swiftbuild/') &&
        !allowed[owner].includes(target.split('/')[1])
      ) {
        console.error(`${path}: forbidden dependency ${target}`);
        failed = true;
      }
      const normalized = target.replaceAll('\\', '/');
      if (
        normalized.startsWith('.') ||
        isAbsolute(normalized) ||
        win32.isAbsolute(target)
      ) {
        const destination = resolve(dir, normalized);
        const fromOwner = relative(resolve('packages', owner), destination);
        if (
          fromOwner === '..' ||
          fromOwner.startsWith(`..${sep}`) ||
          isAbsolute(fromOwner)
        ) {
          console.error(`${path}: use public package exports for ${target}`);
          failed = true;
        }
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
