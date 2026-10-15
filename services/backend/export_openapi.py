"""Export API contracts without connecting to a database or reading private settings."""

import json
import sys
from pathlib import Path

from swiftbuild_backend.config import Settings
from swiftbuild_backend.http import create_app

target = Path(__file__).parent / 'openapi.json'
app = create_app(Settings('', 'http://localhost:3000', 'synthetic-contract-export-' * 3, True))
output = json.dumps(app.openapi(), indent=2, ensure_ascii=False) + '\n'
if '--check' in sys.argv:
    if target.read_text('utf-8') != output:
        raise SystemExit('Backend OpenAPI drift: run pnpm backend:generate.')
else:
    target.write_text(output, encoding='utf-8')
