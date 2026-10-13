"""Numerical models only: no native documents, persistence, or identity."""
import copy
import hashlib
import importlib.metadata
import json
import math
import os
import platform
import sys
from pathlib import Path

import jcs
import numpy as np


def canonical_digest(value):
    return hashlib.sha256(jcs.canonicalize(value)).hexdigest()


def reliability(definition, seed, samples, forced=None):
    variables = definition['components'] + definition['groups']
    identifiers = [v.get('nodeId', v.get('id')) for v in variables]
    probabilities = np.array([v['meanUpSeconds'] / (v['meanUpSeconds'] + v['meanRepairSeconds']) for v in variables])
    count = len(variables)
    exact = count <= 16
    size = (1 << count) if exact else samples
    gates = {g['id']: g for g in definition['gates']}
    total = 0.0
    rng = np.random.Generator(np.random.PCG64(seed))
    for start in range(0, size, 2048):
        length = min(2048, size - start)
        if exact:
            states = ((np.arange(start, start + length, dtype=np.uint64)[:, None] >> np.arange(count, dtype=np.uint64)) & 1).astype(bool)
            weights = np.prod(np.where(states, probabilities, 1 - probabilities), axis=1)
        else:
            states = rng.random((length, count)) < probabilities
            weights = np.full(length, 1 / samples)
        if forced in identifiers:
            states[:, identifiers.index(forced)] = False
        up = {c['nodeId']: states[:, i].copy() for i, c in enumerate(definition['components'])}
        for i, group in enumerate(definition['groups'], len(definition['components'])):
            for node in group['nodeIds']:
                up[node] &= states[:, i]

        def evaluate(identifier):
            if identifier in up:
                return up[identifier]
            gate = gates[identifier]
            children = np.array([evaluate(child) for child in gate['inputs']])
            if gate['kind'] == 'and':
                result = children.all(axis=0)
            elif gate['kind'] == 'or':
                result = children.any(axis=0)
            else:
                result = children.sum(axis=0) >= gate['k']
            up[identifier] = result
            return result

        total += float(weights[evaluate(definition['root'])].sum())
    value = min(1.0, max(0.0, total))
    # Wilson 95% interval, including boundary estimates; sampling error only.
    if exact:
        interval = None
    else:
        z = 1.959963984540054
        center = (value + z*z/(2*samples)) / (1 + z*z/samples)
        half = z * math.sqrt(value*(1-value)/samples + z*z/(4*samples*samples)) / (1 + z*z/samples)
        interval = [max(0, center-half), min(1, center+half)]
    return value, interval, 'exact' if exact else 'monte-carlo'


def slopes(rows):
    rows.sort(key=lambda r: r['x'])
    for i, row in enumerate(rows):
        a, b = (rows[0], rows[1]) if i == 0 else ((rows[-2], rows[-1]) if i == len(rows)-1 else (rows[i-1], rows[i+1]))
        row['slope'] = None if a['value'] is None or b['value'] is None else (b['value'] - a['value']) / (b['x'] - a['x'])
    return rows


def compute(request):
    data = request['input']
    # JSON Schema integers can arrive as 42.0; canonical JSON gives both forms
    # identical bytes. Normalize before calling NumPy's integer-only APIs.
    data = {**data, 'seed': int(data['seed']), 'samples': int(data['samples'])}
    definition = data['definition']
    report = {'contractVersion': '1.0', 'modelVersion': '1.0', 'digest': request['digest'], 'status': 'complete', 'method': 'finite-difference', 'impacts': [], 'sensitivity': [], 'coverage': [], 'assumptions': [], 'runtime': {'python': platform.python_version(), 'numpy': np.__version__, 'fastapi': importlib.metadata.version('fastapi'), 'pydantic': importlib.metadata.version('pydantic'), 'platform': platform.platform(), 'machine': platform.machine(), 'image': os.environ.get('SWIFTBUILD_COMPUTATION_IMAGE', 'local-unpinned'), 'rng': 'PCG64', 'blasThreads': '1'}}
    if definition['kind'] == 'reliability':
        model = definition['reliability']
        value, interval, method = reliability(model, data['seed'], data['samples'])
        report.update(availability=value, method=method)
        if interval is not None:
            report['interval'] = interval
        variables = model['components'] + model['groups']
        for variable in variables:
            identifier = variable.get('nodeId', variable.get('id'))
            forced, _, _ = reliability(model, data['seed'], data['samples'], identifier)
            report['impacts'].append({'targetId': identifier, 'availability': forced, 'loss': value-forced})
        for ranges in definition['ranges']:
            rows = []
            for x in ranges['values']:
                derived = copy.deepcopy(model)
                target = next(v for v in derived['components'] + derived['groups'] if v.get('nodeId', v.get('id')) == ranges['targetId'])
                target[ranges['parameter']] = x
                result, _, _ = reliability(derived, data['seed'], data['samples'])
                rows.append({'targetId': ranges['targetId'], 'parameter': ranges['parameter'], 'x': x, 'value': result, 'slope': None, 'unit': 'ratio', 'slopeUnit': 'ratio/seconds'})
            report['sensitivity'].extend(slopes(rows))
        report['assumptions'] = ['Stationary availability = mean operating time / (mean operating time + mean repair time).', 'Independent component and group variables; a group outage disables every declared member.', 'Forced-outage impact is an intervention, not a conditional probability.', 'Sensitivity uses common seeded samples; slopes describe only the declared range.', 'Sampling intervals describe sampling error, not model accuracy. No outage-duration or SLA guarantee is inferred.']
    else:
        samples = data.get('capacitySamples', [])
        if len(samples) != len(definition['values']):
            raise ValueError('Missing TypeScript sweep evaluations')
        rows = []
        for sample in samples:
            known = sample['status'] == 'complete' and not sample['coverage'] and sample['value'] is not None
            parameter_unit = {'requestsPerSecond': 'ops/s', 'peakMultiplier': 'ratio', 'meanMs': 'ms', 'concurrency': 'slots', 'replicas': 'replicas'}[definition['parameter']]
            rows.append({'targetId': definition['targetId'], 'parameter': definition['parameter'], 'x': sample['x'], 'value': sample['value'] if known else None, 'slope': None, 'unit': sample['unit'], 'slopeUnit': sample['unit'] + '/(' + parameter_unit + ')'})
            report['coverage'].extend(sample['coverage'])
            if not known:
                report['status'] = 'partial'
                report['coverage'].append(f"Incomplete or unknown metric at parameter value {sample['x']}.")
        report['sensitivity'] = slopes(rows)
        report['assumptions'] = ['Capacity samples were computed by the existing TypeScript engine.', 'One parameter varies at a time. Finite differences do not extrapolate or establish causal guarantees.']
        report['assumptions'].append('Seeded simulations contain sampling variation distinct from model error. No confidence bound on derivative estimates is inferred.')
        for sample in samples:
            evidence = sample.get('evidence', {})
            report['assumptions'].extend(evidence.get('assumptions', []))
            report['assumptions'].extend('Limitation: ' + item for item in evidence.get('limitations', []))
            if evidence.get('formula'):
                report['assumptions'].append('Metric formula: ' + evidence['formula'])
        report['assumptions'] = list(dict.fromkeys(report['assumptions']))
    return report


if __name__ == '__main__':
    payload = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    if canonical_digest(payload['input']) != payload['digest']:
        raise ValueError('Digest mismatch')
    try:
        Path(sys.argv[2]).write_text(json.dumps(compute(payload), allow_nan=False), encoding='utf-8')
    except MemoryError:
        sys.exit(75)
