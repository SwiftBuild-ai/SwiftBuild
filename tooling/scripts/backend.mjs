import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../services/backend/', import.meta.url));
export const backendPython =
  process.env.SWIFTBUILD_BACKEND_PYTHON ??
  resolve(
    root,
    process.platform === 'win32'
      ? '.venv/Scripts/python.exe'
      : '.venv/bin/python',
  );
const commands = {
  serve: ['-m', 'swiftbuild_backend'],
  worker: ['-m', 'swiftbuild_backend.worker'],
  operator: ['-m', 'swiftbuild_backend.cli'],
  test: ['-m', 'pytest', '-q'],
  lint: ['-m', 'ruff', 'check', '.'],
  'format-check': ['-m', 'ruff', 'format', '--check', '.'],
  models: ['generate_models.py'],
  openapi: ['export_openapi.py'],
};
export async function runBackend(command, args = [], options = {}) {
  await access(backendPython, constants.F_OK);
  if (!(command in commands)) throw new Error('Unknown backend command.');
  return new Promise((done, reject) => {
    const child = spawn(backendPython, [...commands[command], ...args], {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
      ...options,
    });
    child.on('error', reject);
    child.on('exit', (code, signal) =>
      code === 0
        ? done()
        : reject(new Error(`Backend command failed (${code ?? signal}).`)),
    );
    process.once('SIGTERM', () => child.kill());
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await runBackend(process.argv[2], process.argv.slice(3));
  } catch {
    console.error(
      'Backend command failed. Check Python setup and private configuration.',
    );
    process.exitCode = 1;
  }
}
