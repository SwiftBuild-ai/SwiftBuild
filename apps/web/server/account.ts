import 'server-only';
import { headers } from 'next/headers';
import { backend } from './backend';
export async function accountContext() {
  if (!process.env.SWIFTBUILD_BACKEND_URL) return { state: 'local' as const };
  try {
    const server = backend();
    const context = await server.identity.context(new Headers(await headers()));
    return {
      state: 'ready' as const,
      ...context,
    };
  } catch {
    return { state: 'unavailable' as const };
  }
}
