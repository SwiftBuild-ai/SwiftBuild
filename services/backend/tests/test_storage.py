import asyncio
import copy
import hashlib
from uuid import uuid4

import pytest
from psycopg.errors import UndefinedTable

from swiftbuild_backend.config import Settings
from swiftbuild_backend.database import MIGRATIONS, all_rows, migrate
from swiftbuild_backend.errors import ServiceError
from swiftbuild_backend.identity import Identity, issue_invitation
from swiftbuild_backend.projects import Projects
from test_compatibility import fixture


async def owner(pool):
    identity = Identity(
        pool, Settings('', 'http://localhost:3000', 'synthetic-test-secret-' * 3, True)
    )
    invitation = await issue_invitation(pool, 'owner@example.test', bootstrap=True)
    user = (
        await identity.create_account(
            invitation['email'], 'synthetic password for tests', 'Owner', invitation['token']
        )
    )['user']
    projects = Projects(pool)
    workspace = (await projects.list_workspaces(user['id']))[0]['id']
    return identity, projects, user['id'], workspace


async def test_creation_save_restore_and_retry(pool):
    _, store, user, workspace = await owner(pool)
    source = fixture('archive')['archive']
    operation = str(uuid4())
    project = await store.create_project(user, workspace, source, operation)
    assert await store.create_project(user, workspace, source, operation) == project
    edited = copy.deepcopy(source)
    edited['document']['project']['name'] = 'Edited'
    save = str(uuid4())
    saved = await store.save_project(user, project['id'], 1, edited, save)
    assert saved['revision'] == 2
    assert await store.save_project(user, project['id'], 1, edited, save) == saved
    restore = str(uuid4())
    restored = await store.restore_project(user, project['id'], 2, 1, restore)
    assert restored['revision'] == 3 and restored['archive'] == source
    assert await store.restore_project(user, project['id'], 2, 1, restore) == restored
    with pytest.raises(ServiceError, match='already used'):
        await store.restore_project(user, project['id'], 3, 2, restore)
    with pytest.raises(ServiceError, match='changed'):
        await store.save_project(user, project['id'], 2, source, str(uuid4()))
    assert len(await store.list_revisions(user, project['id'])) == 3
    listed = await store.list_projects(user, workspace)
    assert listed[0]['revision'] == 3 and len(listed[0]['updatedAt'].split('.')[1]) == 7


async def test_competing_saves_and_revocation(pool):
    _, store, user, workspace = await owner(pool)
    source = fixture('archive')['archive']
    project = await store.create_project(user, workspace, source, str(uuid4()))
    a, b = copy.deepcopy(source), copy.deepcopy(source)
    a['document']['project']['name'] = 'A'
    b['document']['project']['name'] = 'B'
    results = await asyncio.gather(
        *(store.save_project(user, project['id'], 1, v, str(uuid4())) for v in (a, b)),
        return_exceptions=True,
    )
    assert sum(isinstance(r, dict) for r in results) == 1
    assert sum(isinstance(r, ServiceError) and r.code == 'REVISION_CONFLICT' for r in results) == 1
    async with pool.connection() as c:
        await c.execute("UPDATE sb_members SET role='viewer' WHERE user_id=%s", (user,))
    assert (await store.read_project(user, project['id']))['role'] == 'viewer'
    with pytest.raises(ServiceError) as forbidden:
        await store.save_project(user, project['id'], 2, a, str(uuid4()))
    assert forbidden.value.status == 403
    async with pool.connection() as c:
        await c.execute('UPDATE sb_admitted_users SET active=false WHERE user_id=%s', (user,))
    with pytest.raises(ServiceError) as absent:
        await store.read_project(user, project['id'])
    assert absent.value.status == 404


async def test_password_recovery_replay_and_disabled_admission(pool):
    identity, _, user, workspace = await owner(pool)
    token, _ = await identity.sign_in('owner@example.test', 'synthetic password for tests')
    assert (await identity.session(token))['user']['id'] == user
    recovery = await identity.issue_recovery('owner@example.test')
    await identity.reset_password(recovery, 'replacement synthetic password')
    assert await identity.session(token) is None
    with pytest.raises(ServiceError):
        await identity.reset_password(recovery, 'another synthetic password')
    token, _ = await identity.sign_in('owner@example.test', 'replacement synthetic password')
    async with pool.connection() as c:
        await c.execute('UPDATE sb_admitted_users SET active=false WHERE user_id=%s', (user,))
    assert await identity.session(token) is None
    invitation = await issue_invitation(pool, 'owner@example.test', workspace_id=workspace)
    with pytest.raises(ServiceError):
        await identity.sign_in(
            'owner@example.test', 'replacement synthetic password', invitation['token']
        )


async def test_bootstrap_rotation_race_and_consumption(pool):
    original = await issue_invitation(pool, 'owner@example.test', bootstrap=True)
    links = await asyncio.gather(
        *(issue_invitation(pool, original['email'], bootstrap=True, rotate=True) for _ in range(2))
    )
    async with pool.connection() as c:
        live = await all_rows(
            c, 'SELECT id FROM sb_invitations WHERE bootstrap AND NOT revoked AND used_by IS NULL'
        )
    assert len(live) == 1
    winner = next(link for link in links if link['id'] == str(live[0]['id']))
    identity = Identity(
        pool, Settings('', 'http://localhost:3000', 'synthetic-test-secret-' * 3, True)
    )
    with pytest.raises(ServiceError):
        await identity.create_account(
            original['email'], 'synthetic password for tests', 'Owner', original['token']
        )
    await identity.create_account(
        winner['email'], 'synthetic password for tests', 'Owner', winner['token']
    )
    with pytest.raises(ValueError, match='admission is complete'):
        await issue_invitation(pool, winner['email'], bootstrap=True, rotate=True)


async def test_migration_checksums_and_transactional_failure(pool):
    await migrate(pool)
    altered = copy.deepcopy(MIGRATIONS)
    altered[0]['sql'] += '\n'
    with pytest.raises(ValueError, match='checksum'):
        await migrate(pool, altered)
    sql = 'CREATE TABLE rollback_probe(id int); SELECT * FROM nonexistent_migration_probe;'
    failed = {
        'id': '0005-rollback-probe',
        'sql': sql,
        'checksum': hashlib.sha256(sql.encode()).hexdigest(),
    }
    with pytest.raises(UndefinedTable):
        await migrate(pool, [*MIGRATIONS, failed])
    async with pool.connection() as c:
        assert len(await all_rows(c, 'SELECT id FROM sb_migrations')) == 4
        assert (await all_rows(c, "SELECT to_regclass('rollback_probe') AS name"))[0][
            'name'
        ] is None


async def test_database_rate_limit(pool):
    identity = Identity(
        pool, Settings('', 'http://localhost:3000', 'synthetic-test-secret-' * 3, True)
    )
    for _ in range(5):
        await identity.rate_limit('sign-in/email', '127.0.0.1')
    with pytest.raises(ServiceError) as rejected:
        await identity.rate_limit('sign-in/email', '127.0.0.1')
    assert rejected.value.status == 429
