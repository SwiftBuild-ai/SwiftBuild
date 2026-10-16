import os
import re
import asyncio
import sys
from uuid import uuid4

import pytest
import pytest_asyncio
from psycopg import sql

from swiftbuild_backend.database import migrate, one, pool_for


@pytest.fixture(scope='session')
def event_loop_policy():
    if sys.platform == 'win32':
        return asyncio.WindowsSelectorEventLoopPolicy()
    return asyncio.DefaultEventLoopPolicy()


@pytest_asyncio.fixture
async def pool():
    url = os.getenv('SWIFTBUILD_TEST_DATABASE_URL')
    if not url:
        pytest.skip('An isolated PostgreSQL _test database is required.')
    admin = pool_for(url)
    await admin.open()
    schema = 'swiftbuild_python_test_' + uuid4().hex
    assert re.fullmatch(r'swiftbuild_python_test_[a-f0-9]{32}', schema)
    scoped, created = None, False
    try:
        async with admin.connection() as c:
            database = await one(c, 'SELECT current_database() AS name')
            if not database['name'].endswith('_test'):
                raise ValueError('An isolated _test database is required.')
            await c.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema)))
            created = True
        scoped = pool_for(url, options=f'-c search_path={schema}')
        await scoped.open()
        await migrate(scoped)
        yield scoped
    finally:
        if scoped:
            await scoped.close()
        if created:
            async with admin.connection() as c:
                await c.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(schema)))
        await admin.close()
