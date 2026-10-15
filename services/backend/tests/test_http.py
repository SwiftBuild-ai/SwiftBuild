import copy
from uuid import uuid4

import httpx
import pytest

from swiftbuild_backend.config import Settings
from swiftbuild_backend.http import create_app
from swiftbuild_backend.identity import issue_invitation
from test_storage import owner
from test_compatibility import fixture


@pytest.fixture
def settings():
    return Settings('', 'http://localhost:3000', 'synthetic-test-secret-' * 3, True)


async def test_http_identity_projects_and_recovery(pool, settings):
    app = create_app(settings, pool=pool)
    link = await issue_invitation(pool, 'owner@example.test', bootstrap=True)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app),
        base_url=settings.origin,
        headers={'origin': settings.origin},
    ) as client:
        response = await client.post(
            '/api/auth/sign-up/email',
            json={
                'email': link['email'],
                'name': 'Owner',
                'password': 'synthetic password for tests',
            },
            headers={'x-swiftbuild-invitation': link['token']},
        )
        assert response.status_code == 200, response.text
        response = await client.post(
            '/api/auth/sign-in/email',
            json={'email': link['email'], 'password': 'synthetic password for tests'},
        )
        assert response.status_code == 200, response.text
        assert 'HttpOnly' in response.headers['set-cookie']
        assert (await client.get('/api/v1/session')).status_code == 200
        workspaces = (await client.get('/api/v1/workspaces')).json()['items']
        body = {
            'workspaceId': workspaces[0]['id'],
            'archive': fixture('archive')['archive'],
            'operationId': str(uuid4()),
        }
        response = await client.post('/api/v1/projects', json=body)
        assert response.status_code == 201, response.text
        project = response.json()
        assert response.headers['etag'] == '"1"'
        assert (await client.post('/api/v1/projects', json=body)).json() == project
        edited = copy.deepcopy(body['archive'])
        edited['document']['project']['name'] = 'Updated'
        save = {'operationId': str(uuid4()), 'archive': edited}
        missing = await client.put('/api/v1/projects/' + project['id'], json=save)
        assert missing.status_code == 428
        saved = await client.put(
            '/api/v1/projects/' + project['id'], json=save, headers={'if-match': '"1"'}
        )
        assert saved.status_code == 200 and saved.json()['revision'] == 2, saved.text
        stale = await client.put(
            '/api/v1/projects/' + project['id'],
            json={**save, 'operationId': str(uuid4())},
            headers={'if-match': '"1"'},
        )
        assert stale.status_code == 412
        exported = await client.get('/api/v1/projects/' + project['id'] + '/export')
        assert exported.json() == edited
        assert 'attachment;' in exported.headers['content-disposition']
        restore = {'sourceRevision': 1.0, 'operationId': str(uuid4())}
        response = await client.post(
            '/api/v1/projects/' + project['id'] + '/restore',
            json=restore,
            headers={'if-match': '"2"'},
        )
        assert response.status_code == 200 and response.json()['revision'] == 3
        assert response.headers['cache-control'] == 'no-store'
        assert response.headers['x-request-id']
        assert (await client.get('/api/v1/ready')).status_code == 200
        await client.post('/api/auth/sign-out', json={})
        assert (await client.get('/api/v1/session')).status_code == 401


async def test_http_stream_limits_origin_and_invalid_json(pool, settings):
    app = create_app(settings, pool=pool)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url=settings.origin
    ) as client:
        assert (await client.post('/api/auth/sign-in/email', json={})).status_code == 403

        async def chunks():
            for _ in range(20):
                yield b'x' * 1024

        oversized = await client.post(
            '/api/auth/sign-up/email',
            content=chunks(),
            headers={'origin': settings.origin, 'content-type': 'application/json'},
        )
        assert oversized.status_code == 413
        for value in (b'\xff', b'NaN', b'{'):
            malformed = await client.post(
                '/api/v1/workspaces',
                content=value,
                headers={'origin': settings.origin, 'content-type': 'application/json'},
            )
            assert (
                malformed.status_code == 400 and malformed.json()['error']['code'] == 'INVALID_JSON'
            )
        denied = await client.get('/api/v1/session')
        assert denied.status_code == 401 and denied.json()['error']['code'] == 'AUTH_REQUIRED'


async def test_registration_requires_the_actual_invitation_token(pool, settings):
    app = create_app(settings, pool=pool)
    await issue_invitation(pool, 'owner@example.test', bootstrap=True)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app),
        base_url=settings.origin,
        headers={'origin': settings.origin},
    ) as client:
        response = await client.post(
            '/api/auth/sign-up/email',
            json={
                'email': 'owner@example.test',
                'name': 'Owner',
                'password': 'synthetic password for tests',
            },
        )
        assert response.status_code == 403


async def test_account_management_revokes_other_sessions_and_preserves_last_method(pool, settings):
    identity, _, _, _ = await owner(pool)
    old, _ = await identity.sign_in('owner@example.test', 'synthetic password for tests')
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(create_app(settings, pool=pool)),
        base_url=settings.origin,
        headers={'origin': settings.origin},
    ) as client:
        assert (
            await client.post(
                '/api/auth/sign-in/email',
                json={
                    'email': 'owner@example.test',
                    'password': 'synthetic password for tests',
                },
            )
        ).status_code == 200
        accounts = await client.get('/api/auth/list-accounts')
        assert accounts.status_code == 200 and len(accounts.json()) == 1
        assert 'password' not in accounts.json()[0]
        async with pool.connection() as c:
            await c.execute(
                'UPDATE sb_auth_sessions SET "updatedAt"=now()-interval \'2 hours\',"expiresAt"=now()+interval \'1 hour\''
            )
        renewed = await client.get('/api/auth/get-session')
        assert renewed.status_code == 200 and 'set-cookie' in renewed.headers
        assert set(renewed.json()) == {'user', 'session'}
        assert {'createdAt', 'updatedAt', 'emailVerified', 'image'} <= renewed.json()['user'].keys()
        assert {'token', 'updatedAt', 'ipAddress', 'userAgent'} <= renewed.json()['session'].keys()
        assert renewed.json()['session']['expiresAt'].endswith('Z')
        denied = await client.post('/api/auth/unlink-account', json={'providerId': 'credential'})
        assert denied.status_code == 400
        changed = await client.post(
            '/api/auth/change-password',
            json={
                'currentPassword': 'synthetic password for tests',
                'newPassword': 'replacement synthetic password',
                'revokeOtherSessions': True,
            },
        )
        assert changed.status_code == 200
        assert await identity.session(old) is None
        assert (await client.get('/api/v1/session')).status_code == 200
        recovery = await identity.issue_recovery('owner@example.test')
        callback = await client.get(
            '/api/auth/reset-password/' + recovery,
            params={'callbackURL': settings.origin + '/reset-password'},
        )
        assert callback.status_code == 302 and 'token=' in callback.headers['location']
        assert (
            await client.post(
                '/api/auth/reset-password',
                json={
                    'token': recovery,
                    'newPassword': 'another synthetic password',
                },
            )
        ).status_code == 200
        assert (await client.get('/api/v1/session')).status_code == 401
        assert (
            await client.post(
                '/api/auth/reset-password',
                json={
                    'token': recovery,
                    'newPassword': 'another synthetic password',
                },
            )
        ).status_code == 400
