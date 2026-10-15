"""Private PostgreSQL backup and isolated restore. Never accepts uploaded SQL."""

import asyncio
import hashlib
import json
import os
import re
import stat
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import uuid4

from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from pydantic import BaseModel, ConfigDict, Field

from .database import check_migrations, migration_plan, one, pool_for, transaction

TABLES = (
    'sb_migrations',
    'sb_workspaces',
    'sb_members',
    'sb_projects',
    'sb_revisions',
    'sb_audit_events',
    'sb_auth_users',
    'sb_auth_sessions',
    'sb_auth_accounts',
    'sb_auth_verifications',
    'sb_auth_limits',
    'sb_admitted_users',
    'sb_instance',
    'sb_invitations',
    'sb_jobs',
    'sb_job_attempts',
    'sb_worker_heartbeats',
)


class Migration(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    id: str
    checksum: str = Field(pattern='^[a-f0-9]{64}$')


class Manifest(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    format: Literal['swiftbuild-database-backup']
    version: Literal['1.0']
    id: str
    snapshotAt: str
    createdAt: str
    database: str = Field(min_length=1, max_length=63)
    serverVersion: int = Field(gt=0)
    dumpVersion: str = Field(max_length=256)
    release: str = Field(min_length=1, max_length=256)
    file: Literal['database.dump']
    bytes: int = Field(gt=0, le=9007199254740991)
    sha256: str = Field(pattern='^[a-f0-9]{64}$')
    migrations: list[Migration] = Field(max_length=1000)
    rows: dict[str, str]


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def file_digest(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def pg_tool(command, arguments, connection):
    settings = conninfo_to_dict(connection)
    mapping = {
        'host': 'PGHOST',
        'port': 'PGPORT',
        'user': 'PGUSER',
        'password': 'PGPASSWORD',
        'dbname': 'PGDATABASE',
        'sslmode': 'PGSSLMODE',
        'sslrootcert': 'PGSSLROOTCERT',
        'sslcert': 'PGSSLCERT',
        'sslkey': 'PGSSLKEY',
        'options': 'PGOPTIONS',
        'connect_timeout': 'PGCONNECT_TIMEOUT',
        'application_name': 'PGAPPNAME',
    }
    if not settings.get('host') or not settings.get('user') or set(settings) - mapping.keys():
        raise ValueError(
            'Configure an explicit supported PostgreSQL connection for recovery tools.'
        )
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    env.update({mapping[k]: v for k, v in settings.items()})
    try:
        result = subprocess.run(
            [command, *arguments], env=env, capture_output=True, timeout=600, check=True
        )
        if len(result.stdout) + len(result.stderr) > 1024 * 1024:
            raise ValueError('PostgreSQL recovery tool output exceeded its limit.')
        return result
    except (subprocess.SubprocessError, OSError):
        raise ValueError(
            'PostgreSQL recovery tool failed. Check tool availability, database access, timeout and disk space.'
        ) from None


async def inventory(c):
    await check_migrations(c)
    counts = {}
    for table in TABLES:
        counts[table] = (
            await one(
                c,
                sql.SQL('SELECT count(*)::text AS n FROM public.{}').format(sql.Identifier(table)),
            )
        )['n']
    return {'migrations': migration_plan(), 'rows': counts}


async def backup_database(connection, directory, release='unrecorded'):
    root = Path(directory).resolve()
    root.mkdir(mode=0o700)  # Refuse existing directories, including partial prior backups.
    pool = pool_for(connection, maximum=1)
    await pool.open()
    try:
        async with transaction(pool) as c:
            await c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
            snapshot_at = timestamp()
            snapshot = (await one(c, 'SELECT pg_export_snapshot() AS id'))['id']
            state = await inventory(c)
            database = (await one(c, 'SELECT current_database() AS name'))['name']
            server_version = int((await one(c, 'SHOW server_version_num'))['server_version_num'])
            tool_version = await asyncio.to_thread(pg_tool, 'pg_dump', ['--version'], connection)
            output = root / 'database.dump'
            with output.open('xb'):
                pass
            output.chmod(0o600)
            dumped = await asyncio.to_thread(
                pg_tool,
                'pg_dump',
                [
                    '--format=custom',
                    '--schema=public',
                    '--no-acl',
                    '--snapshot',
                    snapshot,
                    '--file',
                    str(output),
                ],
                connection,
            )
            if dumped.stderr.strip():
                raise ValueError(
                    'Backup tool reported warnings; review them privately before accepting the backup.'
                )
            manifest = Manifest.model_validate(
                {
                    'format': 'swiftbuild-database-backup',
                    'version': '1.0',
                    'id': str(uuid4()),
                    'snapshotAt': snapshot_at,
                    'createdAt': timestamp(),
                    'database': database,
                    'serverVersion': server_version,
                    'dumpVersion': tool_version.stdout.decode().strip(),
                    'release': release,
                    'file': 'database.dump',
                    'bytes': output.stat().st_size,
                    'sha256': await asyncio.to_thread(file_digest, output),
                    **state,
                }
            ).model_dump()
            temporary = root / 'manifest.tmp'
            with temporary.open('x', encoding='utf-8') as stream:
                temporary.chmod(0o600)
                stream.write(json.dumps(manifest, indent=2) + '\n')
            temporary.rename(root / 'manifest.json')
            return manifest
    finally:
        await pool.close()


def verify_backup(directory):
    root = Path(directory).resolve()
    path = root / 'manifest.json'
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or path.is_symlink() or metadata.st_size > 65536:
        raise ValueError('Backup manifest must be a bounded regular file.')
    manifest = Manifest.model_validate_json(path.read_bytes()).model_dump()
    from uuid import UUID

    UUID(manifest['id'])
    for key in ('snapshotAt', 'createdAt'):
        if not manifest[key].endswith('Z'):
            raise ValueError('Invalid backup timestamp.')
        datetime.fromisoformat(manifest[key])
    if any(not re.fullmatch(r'\d+', v) for v in manifest['rows'].values()):
        raise ValueError('Invalid backup row inventory.')
    dump = root / manifest['file']
    metadata = dump.lstat()
    if (
        not stat.S_ISREG(metadata.st_mode)
        or dump.is_symlink()
        or metadata.st_size != manifest['bytes']
        or file_digest(dump) != manifest['sha256']
    ):
        raise ValueError('Backup integrity verification failed.')
    if manifest['migrations'] != migration_plan() or set(manifest['rows']) != set(TABLES):
        raise ValueError('Backup manifest is incompatible with this release.')
    return manifest


def restore_target(value):
    if not re.fullmatch(r'swiftbuild_restore_[a-z0-9_]{1,35}_test', value):
        raise ValueError('Recovery drills require a new swiftbuild_restore_NAME_test database.')
    return value


async def restore_database(connection, directory, target):
    restore_target(target)
    manifest = await asyncio.to_thread(verify_backup, directory)
    pool = pool_for(connection, maximum=1)
    await pool.open()
    try:
        async with pool.connection() as c:
            if await one(c, 'SELECT 1 FROM pg_database WHERE datname=%s', (target,)):
                raise ValueError('Recovery target already exists; it will not be overwritten.')
            major = int((await one(c, 'SHOW server_version_num'))['server_version_num']) // 10000
            if major != manifest['serverVersion'] // 10000:
                raise ValueError('Recovery drill requires the recorded PostgreSQL major version.')
            await c.execute(
                sql.SQL('CREATE DATABASE {} TEMPLATE template0').format(sql.Identifier(target))
            )
    finally:
        await pool.close()
    restored = make_conninfo(connection, dbname=target)
    pool = pool_for(restored, maximum=1)
    await pool.open()
    try:
        async with pool.connection() as c:
            await c.execute('DROP SCHEMA public')  # No CASCADE; unexpected contents stop recovery.
        await asyncio.to_thread(
            pg_tool,
            'pg_restore',
            [
                '--dbname',
                target,
                '--no-owner',
                '--no-privileges',
                '--single-transaction',
                str(Path(directory).resolve() / 'database.dump'),
            ],
            restored,
        )
        async with transaction(pool) as c:
            await c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
            state = await inventory(c)
            if state['rows'] != manifest['rows']:
                raise ValueError('Restored row inventory differs from the backup snapshot.')
        async with pool.connection() as c:
            await c.execute('ANALYZE')
        return {'database': target, 'backupId': manifest['id'], 'rows': state['rows']}
    finally:
        await pool.close()


async def grant_restored_runtime(pool, database):
    restore_target(database)
    async with pool.connection() as c:
        if (await one(c, 'SELECT current_database() AS name'))['name'] != database:
            raise ValueError('Runtime grants require a connection to the isolated restore target.')
        role = await one(
            c,
            "SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname='swiftbuild_runtime'",
        )
        if not role or any(role.values()):
            raise ValueError('A non-privileged existing swiftbuild_runtime role is required.')
        await c.execute(
            sql.SQL('GRANT CONNECT ON DATABASE {} TO swiftbuild_runtime').format(
                sql.Identifier(database)
            )
        )
        await c.execute('GRANT USAGE ON SCHEMA public TO swiftbuild_runtime')
        for table in TABLES:
            permission = (
                sql.SQL('SELECT')
                if table == 'sb_migrations'
                else sql.SQL('SELECT,INSERT,UPDATE,DELETE')
            )
            await c.execute(
                sql.SQL('GRANT {} ON public.{} TO swiftbuild_runtime').format(
                    permission, sql.Identifier(table)
                )
            )
        await c.execute(
            'REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.sb_migrations FROM swiftbuild_runtime'
        )
