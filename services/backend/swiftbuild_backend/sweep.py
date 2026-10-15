"""Private capacity child process. This entry point needs no database or credentials."""

import copy
import json
import sys
from pathlib import Path

from .analysis import validate_analysis
from .capacity import analyze_topology
from .domain import MAX_COMPUTATION_BYTES, validate_document
from .simulation import simulate_topology


def capacity_sweep(document, execution):
    original = validate_document(document)
    definition = validate_analysis(execution['definition'], original)
    if definition['kind'] != 'capacity-sensitivity':
        raise ValueError('Expected capacity sweep.')
    samples = []
    for value in definition['values']:
        derived = copy.deepcopy(original)
        parameter = definition['parameter']
        if parameter in ('requestsPerSecond', 'peakMultiplier'):
            scenario = next(s for s in derived['scenarios'] if s['id'] == definition['scenarioId'])
            traffic = next(
                t for t in scenario['trafficClasses'] if t['id'] == definition['targetId']
            )
            if parameter == 'requestsPerSecond':
                traffic['workload']['requestsPerSecond'] = value
            else:
                traffic['peakMultiplier'] = value
        else:
            profile = next(
                p for p in derived['performanceProfiles'] if p['id'] == definition['targetId']
            )
            if parameter == 'meanMs':
                profile['serviceTime']['meanMs'] = value
            else:
                profile[parameter] = value
        derived['engineering']['simulation']['seed'] = execution['seed']
        derived = validate_document(derived)
        report = (
            analyze_topology(derived, definition['scenarioId'])
            if definition['engine'] == 'analytical'
            else simulate_topology(derived, definition['scenarioId'])
        )
        metrics = (
            next((n['metrics'] for n in report['nodes'] if n['nodeId'] == definition['nodeId']), [])
            if definition.get('nodeId')
            else report['metrics']
        )
        selected = next((m for m in metrics if m['id'] == definition['metricId']), {})
        evidence = {
            'formula': selected.get('formula', ''),
            'inputs': selected.get('inputs', {}),
            'assumptions': report['assumptions'] + selected.get('assumptions', []),
            'limitations': selected.get('limitations', []),
            'sources': selected.get('sources', []),
        }
        if selected.get('interval'):
            evidence['interval'] = selected['interval']
        if report.get('accounting'):
            evidence['accounting'] = report['accounting']
        samples.append(
            {
                'x': value,
                'value': selected.get('value') if selected.get('status') == 'known' else None,
                'status': report['status'],
                'coverage': [c['message'] for c in report['coverage']],
                'fingerprint': report['fingerprint'],
                'engineVersion': report['engineVersion'],
                'modelVersion': report['modelVersion'],
                'unit': selected.get('unit', 'unknown'),
                'evidence': evidence,
            }
        )
    return samples


def main():
    source, output = map(Path, sys.argv[1:])
    if source.stat().st_size > 50 * 1024 * 1024 + MAX_COMPUTATION_BYTES:
        raise ValueError('Sweep input exceeds its limit.')
    if sys.platform == 'linux':
        import resource

        resource.setrlimit(resource.RLIMIT_CPU, (120, 121))
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_COMPUTATION_BYTES, MAX_COMPUTATION_BYTES))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    value = json.loads(source.read_text('utf-8'))
    result = capacity_sweep(value['document'], value['input'])
    raw = json.dumps(result, allow_nan=False, ensure_ascii=False).encode()
    if len(raw) > MAX_COMPUTATION_BYTES:
        raise ValueError('Sweep output exceeds its limit.')
    with output.open('xb') as stream:
        stream.write(raw)


if __name__ == '__main__':
    main()
