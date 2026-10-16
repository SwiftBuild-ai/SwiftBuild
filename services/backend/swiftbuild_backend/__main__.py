import asyncio
import sys

import uvicorn

from .config import Settings
from .http import create_app


def main():
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    import os

    config = uvicorn.Config(
        create_app(Settings.from_env()),
        host=os.getenv('SWIFTBUILD_BACKEND_HOST', '127.0.0.1'),
        port=int(os.getenv('SWIFTBUILD_BACKEND_PORT', '8001')),
        access_log=False,
        proxy_headers=False,
        loop='none',
    )
    asyncio.run(uvicorn.Server(config).serve())


if __name__ == '__main__':
    main()
