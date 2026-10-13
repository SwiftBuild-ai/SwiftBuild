import { randomUUID, createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  validateArchive,
  serializeArchive,
  MAX_ARCHIVE_BYTES,
} from '@swiftbuild/project-format';
import { ProjectError, type createProjectStore } from './projects';
import type { createIdentity } from './identity';
import { migrations } from './migrate';
import { createJobStore } from './jobs';
import { MAX_COMPUTATION_BYTES } from '@swiftbuild/computation-contracts';
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const uuid = z.uuid();
const version = z.coerce.number().int().positive().max(2147483647);
export async function boundedJson(
  request: Request,
  limit = MAX_ARCHIVE_BYTES + 65536,
): Promise<unknown> {
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim() !==
    'application/json'
  )
    throw new HttpError(415, 'CONTENT_TYPE', 'Use application/json.');
  const reader = request.body?.getReader();
  if (!reader)
    throw new HttpError(400, 'INVALID_INPUT', 'A JSON body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > limit) {
      await reader.cancel();
      throw new HttpError(
        413,
        'INPUT_LIMIT',
        'Input exceeds the allowed byte limit.',
      );
    }
    chunks.push(part.value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) {
    body.set(part, offset);
    offset += part.length;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Input must be valid UTF-8 JSON.');
  }
}
function archiveInput(input: unknown) {
  try {
    const archive = validateArchive(input);
    serializeArchive(archive);
    return archive;
  } catch {
    throw new HttpError(
      400,
      'INVALID_ARCHIVE',
      'Project archive is invalid or exceeds its byte limit.',
    );
  }
}
function expected(request: Request) {
  const value = request.headers.get('if-match');
  if (!value)
    throw new HttpError(
      428,
      'REVISION_REQUIRED',
      'A current revision is required in If-Match.',
    );
  if (!/^"[1-9][0-9]*"$/.test(value))
    throw new HttpError(
      400,
      'INVALID_REVISION',
      'Use a single strong quoted revision tag.',
    );
  return version.parse(value.slice(1, -1));
}
export function createApi(backend: {
  pool: Pool;
  identity: ReturnType<typeof createIdentity>;
  projects: ReturnType<typeof createProjectStore>;
  origin: string;
  oidc: boolean;
}) {
  return async (request: Request): Promise<Response> => {
    const requestId = randomUUID();
    const reply = (body: unknown, status = 200, headers?: HeadersInit) =>
      Response.json(body, {
        status,
        headers: {
          'cache-control': 'no-store',
          'x-request-id': requestId,
          ...headers,
        },
      });
    try {
      const url = new URL(request.url);
      const path = url.pathname
        .replace(/^\/api\/v1\//, '')
        .split('/')
        .map(decodeURIComponent);
      if (
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
        request.headers.get('origin') !== backend.origin
      )
        throw new HttpError(
          403,
          'UNTRUSTED_ORIGIN',
          'A same-origin request is required.',
        );
      if (path.join('/') === 'ready' && request.method === 'GET') {
        const applied = await backend.pool.query<{
          id: string;
          checksum: string;
        }>('SELECT id,checksum FROM sb_migrations ORDER BY id');
        if (
          applied.rows.length !== migrations.length ||
          applied.rows.some(
            (row, i) =>
              row.id !== migrations[i]!.id ||
              row.checksum !==
                createHash('sha256').update(migrations[i]!.sql).digest('hex'),
          )
        )
          throw new HttpError(
            503,
            'MIGRATIONS_REQUIRED',
            'Apply the migrations for this server version.',
          );
        if (process.env.SWIFTBUILD_COMPUTATION_ENABLED === '1') {
          const workers = await backend.pool.query(
            "SELECT 1 FROM sb_worker_heartbeats WHERE updated_at>now()-interval '30 seconds' LIMIT 1",
          );
          if (!workers.rowCount)
            throw new HttpError(
              503,
              'WORKER_UNAVAILABLE',
              'The computation dispatcher is unavailable.',
            );
        }
        return reply({ status: 'ready' });
      }
      const session = await backend.identity.session(request.headers);
      if (!session)
        throw new HttpError(
          401,
          'AUTH_REQUIRED',
          'Sign in to access server projects.',
        );
      const userId = session.user.id;
      if (path.join('/') === 'session' && request.method === 'GET')
        return reply({
          user: {
            id: userId,
            name: session.user.name,
            email: session.user.email,
          },
          oidc: backend.oidc,
        });
      if (
        path.join('/') === 'invitations/accept' &&
        request.method === 'POST'
      ) {
        const body = z
          .object({ token: z.string().min(1).max(128) })
          .strict()
          .parse(await boundedJson(request, 16384));
        await backend.identity.acceptInvitation(request.headers, body.token);
        return reply({ status: 'accepted' });
      }
      if (path.join('/') === 'workspaces') {
        if (request.method === 'GET') {
          const items = await backend.projects.listWorkspaces(
            userId,
            url.searchParams.get('after') ?? undefined,
          );
          return reply({
            items,
            nextCursor: items.length === 100 ? items.at(-1)!.id : null,
          });
        }
        if (request.method === 'POST') {
          const body = z
            .object({ name: z.string().trim().min(1).max(120) })
            .strict()
            .parse(await boundedJson(request, 16384));
          return reply(
            await backend.projects.createWorkspace(userId, body.name),
            201,
          );
        }
      }
      if (path.join('/') === 'projects') {
        if (request.method === 'GET') {
          const workspaceId = uuid.parse(url.searchParams.get('workspaceId'));
          const afterId = url.searchParams.get('afterId'),
            beforeUpdatedAt = url.searchParams.get('beforeUpdatedAt');
          if (!!afterId !== !!beforeUpdatedAt)
            throw new HttpError(
              400,
              'INVALID_CURSOR',
              'Both project cursor fields are required.',
            );
          const items = await backend.projects.listProjects(
            userId,
            workspaceId,
            afterId
              ? {
                  id: uuid.parse(afterId),
                  updatedAt: z.iso.datetime().parse(beforeUpdatedAt),
                }
              : undefined,
          );
          const last = items.at(-1);
          return reply({
            items,
            nextCursor:
              items.length === 100 && last
                ? { id: last.id, updatedAt: last.updatedAt }
                : null,
          });
        }
        if (request.method === 'POST') {
          const body = z
            .object({
              workspaceId: uuid,
              operationId: uuid,
              archive: z.unknown(),
            })
            .strict()
            .parse(await boundedJson(request));
          const project = await backend.projects.createProject(
            userId,
            body.workspaceId,
            archiveInput(body.archive),
            body.operationId,
          );
          return reply(project, 201, { etag: `"${project.revision}"` });
        }
      }
      if (path[0] === 'projects' && path.length >= 2) {
        const projectId = uuid.parse(path[1]);
        if (path[2] === 'jobs') {
          const jobs = createJobStore(backend.pool);
          if (path.length === 3 && request.method === 'POST') {
            const body = z
              .strictObject({
                operationId: uuid,
                input: z.unknown(),
                imported: z.boolean().default(false),
              })
              .parse(await boundedJson(request, MAX_COMPUTATION_BYTES));
            return reply(
              await jobs.submit(
                userId,
                projectId,
                expected(request),
                body.operationId,
                body.input,
                body.imported,
              ),
              202,
            );
          }
          if (path.length === 3 && request.method === 'GET') {
            const items = await jobs.list(
              userId,
              projectId,
              url.searchParams.get('before') ?? undefined,
            );
            return reply({
              items,
              nextCursor: items.length === 100 ? items.at(-1)!.id : null,
            });
          }
          if (path.length === 4 && request.method === 'GET')
            return reply(
              await jobs.read(userId, projectId, uuid.parse(path[3])),
            );
          if (
            path.length === 5 &&
            path[4] === 'cancel' &&
            request.method === 'POST'
          ) {
            await jobs.cancel(userId, projectId, uuid.parse(path[3]));
            return reply({ status: 'accepted' });
          }
          if (
            path.length === 5 &&
            path[4] === 'export' &&
            request.method === 'GET'
          )
            return reply(
              await jobs.export(userId, projectId, uuid.parse(path[3])),
            );
        }
        if (path.length === 2 && request.method === 'GET') {
          const query = url.searchParams.get('revision');
          const project = await backend.projects.readProject(
            userId,
            projectId,
            query ? version.parse(query) : undefined,
          );
          return reply(project, 200, { etag: `"${project.revision}"` });
        }
        if (path.length === 2 && request.method === 'PUT') {
          const expectedRevision = expected(request);
          const body = z
            .object({ archive: z.unknown(), operationId: uuid })
            .strict()
            .parse(await boundedJson(request));
          const project = await backend.projects.saveProject(
            userId,
            projectId,
            expectedRevision,
            archiveInput(body.archive),
            body.operationId,
          );
          return reply(project, 200, { etag: `"${project.revision}"` });
        }
        if (
          path[2] === 'revisions' &&
          path.length === 3 &&
          request.method === 'GET'
        ) {
          const before = url.searchParams.get('before');
          const items = await backend.projects.listRevisions(
            userId,
            projectId,
            before ? version.parse(before) : undefined,
          );
          return reply({
            items,
            nextCursor: items.length === 100 ? items.at(-1)!.revision : null,
          });
        }
        if (
          path[2] === 'export' &&
          path.length === 3 &&
          request.method === 'GET'
        ) {
          const project = await backend.projects.readProject(userId, projectId);
          return new Response(serializeArchive(project.archive), {
            headers: {
              'content-type': 'application/json',
              'cache-control': 'no-store',
              'x-request-id': requestId,
              'content-disposition': `attachment; filename="swiftbuild-project-${projectId}.json"`,
            },
          });
        }
      }
      throw new HttpError(404, 'NOT_FOUND', 'Endpoint not found.');
    } catch (error) {
      let status = 503,
        code = 'STORAGE_UNAVAILABLE',
        message =
          'Server storage is unavailable. Preserve local work and retry.';
      if (error instanceof HttpError) {
        ({ status, code, message } = error);
      } else if (error instanceof ProjectError) {
        status = error.code === 'REVISION_CONFLICT' ? 412 : error.status;
        code = error.code;
        message = error.message;
      } else if (error instanceof z.ZodError) {
        status = 400;
        code = 'INVALID_INPUT';
        message = 'Request fields are invalid.';
      } else if (
        error instanceof Error &&
        'statusCode' in error &&
        typeof error.statusCode === 'number'
      ) {
        status = error.statusCode;
        code = 'AUTHORIZATION_ERROR';
        message = 'The authentication or invitation request was rejected.';
      }
      if (status >= 500)
        console.error(
          JSON.stringify({
            event: 'server.request.failed',
            requestId,
            status,
            code,
          }),
        );
      return reply({ error: { code, message }, requestId }, status);
    }
  };
}
