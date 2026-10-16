"""Explicit transactions and the original immutable migration ledger."""

import hashlib
import json
import re
from contextlib import asynccontextmanager
from pathlib import Path

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

MIGRATIONS = json.loads((Path(__file__).parent / 'contracts/migrations.json').read_text('utf-8'))


def pool_for(url, *, options=None, maximum=10):
    return AsyncConnectionPool(
        url,
        open=False,
        min_size=0,
        max_size=maximum,
        timeout=5,
        kwargs={
            'autocommit': True,
            'row_factory': dict_row,
            **({'options': options} if options is not None else {}),
            'connect_timeout': 5,
            'application_name': 'SwiftBuild',
        },
        configure=configure,
    )


async def configure(connection):
    await connection.execute('SET statement_timeout=15000')


@asynccontextmanager
async def transaction(pool):
    async with pool.connection() as connection:
        async with connection.transaction():
            yield connection


async def one(connection, sql, params=()):
    return await (await connection.execute(sql, params)).fetchone()


async def all_rows(connection, sql, params=()):
    return await (await connection.execute(sql, params)).fetchall()


def migration_plan(plan=MIGRATIONS):
    ids = [m['id'] for m in plan]
    if (
        len(set(ids)) != len(ids)
        or ids != sorted(ids)
        or any(not re.fullmatch(r'\d{4}-[a-z0-9-]+', i) for i in ids)
    ):
        raise ValueError('Migration IDs must be unique and ordered.')
    for migration in plan:
        if hashlib.sha256(migration['sql'].encode()).hexdigest() != migration['checksum']:
            raise ValueError('Migration source checksum mismatch.')
    return [{'id': m['id'], 'checksum': m['checksum']} for m in plan]


async def check_migrations(connection, plan=MIGRATIONS):
    applied = await all_rows(connection, 'SELECT id,checksum FROM sb_migrations ORDER BY id')
    if applied != migration_plan(plan):
        raise ValueError('Apply the migrations matching this release.')


async def migrate(pool, plan=MIGRATIONS):
    expected = migration_plan(plan)
    async with transaction(pool) as connection:
        await connection.execute('SELECT pg_advisory_xact_lock(1398233414)')
        await connection.execute(
            'CREATE TABLE IF NOT EXISTS sb_migrations (id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())'
        )
        applied = await all_rows(connection, 'SELECT id,checksum FROM sb_migrations ORDER BY id')
        if applied != expected[: len(applied)] or len(applied) > len(expected):
            raise ValueError(
                'Applied migrations do not match this server version. Restore the matching release; do not edit migration history.'
            )
        for migration in plan[len(applied) :]:
            await connection.execute(migration['sql'])
            await connection.execute(
                'INSERT INTO sb_migrations (id,checksum) VALUES (%s,%s)',
                (migration['id'], migration['checksum']),
            )
