import { readFile, writeFile } from 'node:fs/promises';
import openapiTS, { astToString } from 'openapi-typescript';
import prettier from 'prettier';
import { fileURLToPath } from 'node:url';

const schema = new URL('../../services/backend/openapi.json', import.meta.url);
const target = new URL(
  '../../apps/web/server/api.generated.ts',
  import.meta.url,
);
const config = await prettier.resolveConfig(fileURLToPath(target));
const source = astToString(await openapiTS(schema));
const formatted = await prettier.format(source, {
  ...config,
  parser: 'typescript',
});
if (process.argv.includes('--check')) {
  if ((await readFile(target, 'utf8')) !== formatted)
    throw new Error('Backend TypeScript API drift.');
} else await writeFile(target, formatted);
