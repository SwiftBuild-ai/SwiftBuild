import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { connectBackend } from './backend';
import { parseDocument } from '@swiftbuild/architecture-schema';

const fixtureId = process.env.SWIFTBUILD_SMOKE_RESTART_ID;
const password = process.env.SWIFTBUILD_SMOKE_RESTART_PASSWORD;
if (!fixtureId || !/^[a-f\d]{32}$/.test(fixtureId) || !password)
  throw new Error(
    'Restart smoke requires the original private synthetic fixture.',
  );
const backend = connectBackend();
try {
  const database = (
    await backend.pool.query('SELECT current_database() AS name')
  ).rows[0].name as string;
  if (!database.endsWith('_test'))
    throw new Error('Restart smoke requires an isolated _test database.');
  const endpoint = process.env.SWIFTBUILD_SMOKE_WEB_URL ?? 'http://web:3000';
  const origin = new URL(process.env.SWIFTBUILD_URL!).origin;
  let cookie = '';
  async function request(
    path: string,
    method = 'GET',
    body?: unknown,
    extra: Record<string, string> = {},
  ) {
    const response = await fetch(endpoint + path, {
      method,
      headers: { origin, cookie, 'content-type': 'application/json', ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok)
      throw new Error(
        `Restart smoke request failed with status ${response.status}.`,
      );
    return response;
  }
  await request('/api/v1/ready');
  const signed = await request('/api/auth/sign-in/email', 'POST', {
    email: 'smoke-' + fixtureId + '@example.test',
    password,
  });
  cookie = signed.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  const workspaces = await (await request('/api/v1/workspaces')).json();
  const workspace = workspaces.items.find(
    (item: { name: string }) => item.name === 'Engineering smoke',
  );
  assert.ok(workspace, 'Original membership must survive recreation.');
  const projects = await (
    await request(`/api/v1/projects?workspaceId=${workspace.id}`)
  ).json();
  assert.equal(
    projects.items.length,
    1,
    'Original project must survive without duplication.',
  );
  const project = await (
    await request(`/api/v1/projects/${projects.items[0].id}`)
  ).json();
  assert.equal(project.revision, 2);
  const original = parseDocument(
    JSON.parse(
      await readFile(
        new URL('../../../examples/commerce.swiftbuild.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  assert.deepEqual(project.archive.document, original);
  for (const revision of [1, 2]) {
    const historical = await (
      await request(`/api/v1/projects/${project.id}?revision=${revision}`)
    ).json();
    assert.deepEqual(historical.archive.document, original);
  }
  const archive = structuredClone(project.archive);
  archive.document.nodes[0].name = 'Saved after service recreation';
  const saved = await (
    await request(
      `/api/v1/projects/${project.id}`,
      'PUT',
      { archive, operationId: randomUUID() },
      { 'if-match': '"2"' },
    )
  ).json();
  assert.equal(saved.revision, 3);
  const reopened = await (
    await request(`/api/v1/projects/${project.id}`)
  ).json();
  assert.deepEqual(reopened.archive, archive);
  console.log(
    JSON.stringify({
      event: 'deployment.restart-smoke.passed',
      checks: [
        'readiness',
        'identity',
        'membership',
        'project-and-history',
        'save-after-recreation',
      ],
    }),
  );
} finally {
  await backend.pool.end();
}
