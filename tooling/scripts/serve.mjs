import { cp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const app = fileURLToPath(new URL('../../apps/web/', import.meta.url));
const runtime = join(app, '.next/standalone/apps/web');
const portIndex = process.argv.indexOf('--port');
const port =
  portIndex >= 0 ? process.argv[portIndex + 1] : (process.env.PORT ?? '3000');
if (!port || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
  throw new Error('Port must be between 1 and 65535.');
await cp(join(app, '.next/static'), join(runtime, '.next/static'), {
  recursive: true,
});
await cp(join(app, 'public'), join(runtime, 'public'), { recursive: true });
const server = spawn(process.execPath, [join(runtime, 'server.js')], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: port,
    HOSTNAME: '0.0.0.0',
    NEXT_TELEMETRY_DISABLED: '1',
  },
});
process.on('SIGINT', () => server.kill('SIGINT'));
process.on('SIGTERM', () => server.kill('SIGTERM'));
server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.on('exit', (code) => {
  process.exitCode = code ?? 0;
});
