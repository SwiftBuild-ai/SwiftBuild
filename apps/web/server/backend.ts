import 'server-only';
import { headers } from 'next/headers';
import {
  validateArchive,
  type ProjectArchive,
} from '@swiftbuild/canvas/workspace';
import type { components } from './api.generated';

export type ServerSession = Pick<
  components['schemas']['SessionOutput'],
  'user'
>;
export type ServerProject = Omit<
  components['schemas']['ProjectOutput'],
  'archive' | 'role'
> & {
  archive: ProjectArchive;
  role: 'owner' | 'editor' | 'viewer';
};
export class BackendError extends Error {
  constructor(readonly status: number) {
    super('The server request could not be completed.');
  }
}
function backendUrl(path: string) {
  const configured = process.env.SWIFTBUILD_BACKEND_URL;
  if (!configured) throw new Error('FastAPI storage is not configured.');
  const base = new URL(configured);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== '/' ||
    !path.startsWith('/api/')
  )
    throw new Error('Configure a backend origin URL.');
  return new URL(path, base);
}
async function serverResponse(path: string, incoming?: Headers) {
  const source = incoming ?? new Headers(await headers());
  const response = await fetch(backendUrl(path), {
    headers: { cookie: source.get('cookie') ?? '' },
    cache: 'no-store',
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new BackendError(response.status);
  return response;
}
/** Server rendering calls HTTP; no database or identity policy lives here. */
export function backend() {
  return {
    identity: {
      async context(incoming: Headers) {
        const response = await serverResponse(
          '/api/auth/get-session',
          incoming,
        );
        return {
          session: (await response.json()) as ServerSession | null,
          oidc: response.headers.get('x-swiftbuild-oidc') === '1',
        };
      },
    },
    projects: {
      async listWorkspaces(_userId: string) {
        const response = await serverResponse('/api/v1/workspaces');
        const result = (await response.json()) as {
          items: {
            id: string;
            name: string;
            role: 'owner' | 'editor' | 'viewer';
          }[];
        };
        return result.items;
      },
      async readProject(_userId: string, projectId: string) {
        const response = await serverResponse(
          '/api/v1/projects/' + encodeURIComponent(projectId),
        );
        const project = (await response.json()) as ServerProject;
        return { ...project, archive: validateArchive(project.archive) };
      },
    },
  };
}
/** Same-origin transport preserves streams and individual Set-Cookie headers. */
export async function proxyBackend(request: Request) {
  try {
    const incoming = new URL(request.url);
    const forwarded = new Headers();
    for (const name of [
      'accept',
      'content-type',
      'cookie',
      'origin',
      'if-match',
      'x-swiftbuild-invitation',
    ]) {
      const value = request.headers.get(name);
      if (value !== null) forwarded.set(name, value);
    }
    const options: RequestInit & { duplex?: 'half' } = {
      method: request.method,
      headers: forwarded,
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(30000)]),
    };
    if (request.body) {
      options.body = request.body;
      options.duplex = 'half';
    }
    const upstream = await fetch(
      backendUrl(incoming.pathname + incoming.search),
      options,
    );
    const outgoing = new Headers(upstream.headers);
    for (const name of [
      'connection',
      'transfer-encoding',
      'keep-alive',
      'proxy-authenticate',
      'proxy-authorization',
      'te',
      'trailer',
      'upgrade',
      'content-encoding',
      'content-length',
      'set-cookie',
    ])
      outgoing.delete(name);
    for (const cookie of upstream.headers.getSetCookie())
      outgoing.append('set-cookie', cookie);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: outgoing,
    });
  } catch {
    return unavailable();
  }
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
