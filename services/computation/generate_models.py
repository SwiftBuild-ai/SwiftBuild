"""Generate Python types from the authoritative TypeScript JSON schemas."""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

root = Path(__file__).parent
schemas = json.loads((root / 'contracts.json').read_text(encoding='utf-8'))
check = '--check' in sys.argv
for name, schema in schemas.items():
    with tempfile.TemporaryDirectory() as directory:
        source = Path(directory) / 'schema.json'
        output = Path(directory) / 'model.py'
        source.write_text(json.dumps(schema), encoding='utf-8')
        subprocess.run([sys.executable, '-m', 'datamodel_code_generator', '--input', str(source), '--input-file-type', 'jsonschema', '--output', str(output), '--output-model-type', 'pydantic_v2.BaseModel', '--class-name', name, '--disable-timestamp', '--use-standard-collections', '--use-union-operator', '--target-python-version', '3.12'], check=True)
        generated = output.read_text(encoding='utf-8').replace('#   filename:  schema.json', '#   filename:  TypeScript computation contracts')
        destination = root / 'generated' / f'{name}.py'
        if check:
            if destination.read_text(encoding='utf-8') != generated:
                raise SystemExit(f'Generated model drift: {name}')
        else:
            destination.parent.mkdir(exist_ok=True)
            destination.write_text(generated, encoding='utf-8')
