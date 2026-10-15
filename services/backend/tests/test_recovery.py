import hashlib
import json
import os
import shutil
from uuid import uuid4

import pytest
from psycopg import sql
from psycopg.conninfo import make_conninfo

from swiftbuild_backend.database import migrate, migration_plan, one, pool_for
from swiftbuild_backend.recovery import (
    TABLES,
    backup_database,
    restore_database,
    restore_target,
    verify_backup,
)
from test_storage import owner


def synthetic_backup(directory):
    data = b'trusted synthetic dump bytes'
    (directory / 'database.dump').write_bytes(data)
    manifest = {
        'format': 'swiftbuild-database-backup',
        'version': '1.0',
        'id': str(uuid4()),
        'snapshotAt': '2026-10-15T00:00:00Z',
        'createdAt': '2026-10-15T00:00:01Z',
        'database': 'swiftbuild',
        'serverVersion': 160000,
        'dumpVersion': 'pg_dump 16',
        'release': 'synthetic',
        'file': 'database.dump',
        'bytes': len(data),
        'sha256': hashlib.sha256(data).hexdigest(),
        'migrations': migration_plan(),
        'rows': dict.fromkeys(TABLES, '0'),
    }
    (directory / 'manifest.json').write_text(json.dumps(manifest))
    return manifest


def test_backup_manifest_integrity_and_path_safety(tmp_path):
    expected = synthetic_backup(tmp_path)
    assert verify_backup(tmp_path) == expected
    for patch in (
        {'version': '2.0'},
        {'file': '../database.dump'},
        {'migrations': []},
        {'rows': {}},
        {'bytes': 0},
    ):
        (tmp_path / 'manifest.json').write_text(json.dumps({**expected, **patch}))
        with pytest.raises(ValueError):
            verify_backup(tmp_path)
    (tmp_path / 'manifest.json').write_text(json.dumps(expected))
    (tmp_path / 'database.dump').write_bytes(b'modified')
    with pytest.raises(ValueError, match='integrity'):
        verify_backup(tmp_path)
    for target in (
        'swiftbuild',
        'production_test',
        'swiftbuild_restore_x_test;DROP DATABASE swiftbuild',
        'swiftbuild_restore_' + 'a' * 36 + '_test',
    ):
        with pytest.raises(ValueError, match='Recovery drills require'):
            restore_target(target)


async def test_real_native_backup_restore_and_operation_replay(tmp_path):
    connection = os.getenv('SWIFTBUILD_TEST_DATABASE_URL')
    if not connection or not shutil.which('pg_dump') or not shutil.which('pg_restore'):
        pytest.skip('An isolated _test database and native PostgreSQL tools are required.')
    database = 'swiftbuild_backup_' + uuid4().hex[:12] + '_test'
    target = 'swiftbuild_restore_' + uuid4().hex[:12] + '_test'
    admin = pool_for(connection, maximum=1)
    await admin.open()
    pool = pool_for(make_conninfo(connection, dbname=database), maximum=1)
    restored_pool = None
    try:
        async with admin.connection() as c:
            if not (await one(c, 'SELECT current_database() AS name'))['name'].endswith('_test'):
                raise ValueError('An isolated _test database is required.')
            await c.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(database)))
        await pool.open()
        await migrate(pool)
        _, projects, user, workspace = await owner(pool)
        from test_compatibility import fixture

        archive = fixture('archive')['archive']
        operation_id = str(uuid4())
        project = await projects.create_project(user, workspace, archive, operation_id)
        directory = tmp_path / 'backup'
        manifest = await backup_database(
            make_conninfo(connection, dbname=database), directory, 'synthetic-test'
        )
        assert verify_backup(directory) == manifest
        result = await restore_database(connection, directory, target)
        assert result['rows'] == manifest['rows']
        restored_pool = pool_for(make_conninfo(connection, dbname=target), maximum=1)
        await restored_pool.open()
        from swiftbuild_backend.projects import Projects

        replay = await Projects(restored_pool).create_project(
            user, workspace, archive, operation_id
        )
        assert replay == project
        with pytest.raises(ValueError, match='already exists'):
            await restore_database(connection, directory, target)
    finally:
        if restored_pool:
            await restored_pool.close()
        await pool.close()
        async with admin.connection() as c:
            # Names are generated above and never accept a user-supplied target.
            for value in (database, target):
                await c.execute(
                    sql.SQL('DROP DATABASE IF EXISTS {} WITH (FORCE)').format(sql.Identifier(value))
                )
        await admin.close()
