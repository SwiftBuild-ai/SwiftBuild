"""Generate Python model documentation from the committed structural contracts."""

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

root = Path(__file__).parent / 'swiftbuild_backend'
schemas = json.loads((root / 'contracts/schemas.json').read_text('utf-8'))
for name, schema in schemas.items():
    with tempfile.TemporaryDirectory() as directory:
        source, output = Path(directory) / 'schema.json', Path(directory) / 'model.py'
        source.write_text(json.dumps(schema), encoding='utf-8')
        subprocess.run(
            [
                sys.executable,
                '-m',
                'datamodel_code_generator',
                '--input',
                str(source),
                '--input-file-type',
                'jsonschema',
                '--output',
                str(output),
                '--output-model-type',
                'pydantic_v2.BaseModel',
                '--class-name',
                name,
                '--disable-timestamp',
                '--use-standard-collections',
                '--use-union-operator',
                '--target-python-version',
                '3.12',
            ],
            check=True,
        )
        generated = output.read_text('utf-8').replace(
            '#   filename:  schema.json', '#   filename:  SwiftBuild structural contracts'
        )
        # The pinned generator emits a self-reference in a RootModel *base class*,
        # which Python evaluates before the class exists. Pydantic's JsonValue is
        # the exact built-in recursive JSON type represented by this Zod $def.
        if 'class FieldSchema0(' in generated:
            generated = re.sub(r'class FieldSchema0\(.*?\n\n\n', '', generated, count=1, flags=re.S)
            generated = generated.replace(
                'from __future__ import annotations',
                'from __future__ import annotations\n\nfrom pydantic import JsonValue as FieldSchema0',
            )
            generated = generated.replace('FieldSchema0.model_rebuild()\n', '')
        generated = generated.rstrip() + '\n'
        target = root / 'generated' / f'{name}.py'
        if '--check' in sys.argv:
            if target.read_text('utf-8') != generated:
                raise SystemExit(f'Backend model drift: {name}')
        else:
            target.parent.mkdir(exist_ok=True)
            target.write_text(generated, encoding='utf-8')
