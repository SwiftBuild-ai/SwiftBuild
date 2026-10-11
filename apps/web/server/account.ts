import 'server-only';
import { headers } from 'next/headers';
import { backend } from './backend';
export async function accountContext() {
  if (!process.env.DATABASE_URL) return { state: 'local' as const };
  try {
    const server = backend();
    const session = await server.identity.session(new Headers(await headers()));
    return {
      state: 'ready' as const,
      session,
      oidc: !!process.env.SWIFTBUILD_OIDC_DISCOVERY_URL,
    };
  } catch {
    return { state: 'unavailable' as const };
  }
}
