import 'server-only';
import { connectBackend } from '@swiftbuild/server-core';
const state = globalThis as typeof globalThis & {
  swiftbuildBackend?: ReturnType<typeof connectBackend>;
};
export function backend() {
  if (!state.swiftbuildBackend) {
    state.swiftbuildBackend = connectBackend();
    const pool = state.swiftbuildBackend.pool;
    process.once('SIGTERM', () => {
      void pool.end();
    });
  }
  return state.swiftbuildBackend;
}
export const unavailable = () =>
  Response.json(
    {
      error: {
        code: 'SERVER_UNAVAILABLE',
        message:
          'Server projects are unavailable. Local drafts remain available.',
      },
    },
    { status: 503, headers: { 'cache-control': 'no-store' } },
  );
