"""Native dispatcher readiness probe; no public credentials or output."""

import asyncio
import os
import sys

from .database import one, pool_for


async def check():
    pool = pool_for(os.environ['DATABASE_URL'], maximum=1)
    await pool.open()
    try:
        async with pool.connection() as connection:
            return bool(
                await one(
                    connection,
                    "SELECT 1 FROM sb_worker_heartbeats WHERE updated_at>now()-interval '30 seconds' LIMIT 1",
                )
            )
    finally:
        await pool.close()


def main():
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    try:
        healthy = asyncio.run(check())
    except Exception:
        healthy = False
    raise SystemExit(0 if healthy else 1)


if __name__ == '__main__':
    main()
