from .domain import validate_contract


def validate_analysis(value, document):
    definition = validate_contract('AnalysisDefinition', value)
    if definition['kind'] == 'capacity-sensitivity':
        scenario = next(
            (s for s in document['scenarios'] if s['id'] == definition['scenarioId']), None
        )
        if not scenario:
            raise ValueError('Select an existing scenario.')
        parameter, target = definition['parameter'], definition['targetId']
        if parameter in ('requestsPerSecond', 'peakMultiplier'):
            traffic = next((t for t in scenario['trafficClasses'] if t['id'] == target), None)
            if not traffic or (
                parameter == 'requestsPerSecond' and traffic['workload']['kind'] != 'rate'
            ):
                raise ValueError('Select a compatible traffic class.')
        else:
            profile = next((p for p in document['performanceProfiles'] if p['id'] == target), None)
            if not profile or (
                parameter == 'meanMs'
                and (
                    not profile.get('serviceTime') or profile['serviceTime']['kind'] == 'empirical'
                )
            ):
                raise ValueError('Select a compatible performance profile.')
        if definition.get('nodeId') and not any(
            n['id'] == definition['nodeId'] for n in document['nodes']
        ):
            raise ValueError('Metric node does not exist.')
        if any(
            (parameter != 'requestsPerSecond' and v <= 0)
            or (parameter in ('concurrency', 'replicas') and v % 1)
            for v in definition['values']
        ):
            raise ValueError('Values are incompatible with this parameter.')
        if len(set(definition['values'])) != len(definition['values']):
            raise ValueError('Sweep values must be distinct.')
    else:
        r = definition['reliability']
        ids = [c['nodeId'] for c in r['components']] + [g['id'] for g in r['groups'] + r['gates']]
        if len(set(ids)) != len(ids):
            raise ValueError('Analysis identifiers must be unique.')
        nodes, components = (
            {n['id'] for n in document['nodes']},
            {c['nodeId'] for c in r['components']},
        )
        if not components.issubset(nodes):
            raise ValueError('A reliability node is missing.')
        for group in r['groups']:
            if not set(group['nodeIds']).issubset(components) or len(set(group['nodeIds'])) != len(
                group['nodeIds']
            ):
                raise ValueError('Failure groups must reference distinct declared components.')
        gates, completed = {g['id']: g for g in r['gates']}, set()

        def visit(identifier, path):
            if identifier in completed or identifier in components:
                return
            gate = gates.get(identifier)
            if not gate or identifier in path:
                raise ValueError('Success gates contain a cycle or invalid reference.')
            if (
                len(set(gate['inputs'])) != len(gate['inputs'])
                or (
                    gate['kind'] == 'k-of-n'
                    and (not gate.get('k') or gate['k'] > len(gate['inputs']))
                )
                or (gate['kind'] != 'k-of-n' and 'k' in gate)
            ):
                raise ValueError('Invalid success gate threshold or duplicate input.')
            for next_ in gate['inputs']:
                visit(next_, path | {identifier})
            completed.add(identifier)

        visit(r['root'], set())
        for gate in r['gates']:
            visit(gate['id'], set())
        if 1 + sum(len(r['values']) for r in definition['ranges']) > 50:
            raise ValueError('At most 50 evaluations are allowed.')
        for range_ in definition['ranges']:
            if (
                range_['targetId'] not in components | {g['id'] for g in r['groups']}
                or len(set(range_['values'])) != len(range_['values'])
                or (
                    range_['parameter'] == 'meanUpSeconds' and any(v <= 0 for v in range_['values'])
                )
            ):
                raise ValueError('Invalid reliability range.')
    return definition
