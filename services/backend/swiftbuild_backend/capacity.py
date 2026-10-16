"""Capacity equations and evidence shared by the Python analytical/simulation engines."""

import math

from .domain import validate_document
from .serialization import js_json, utf16

ENGINE_VERSION = '1.2.0-python.1'


def fingerprint(document):
    def canonical(value):
        if isinstance(value, list):
            items = [canonical(v) for v in value]
            key = (
                (lambda v: utf16(str(v['id'])))
                if all(isinstance(v, dict) and 'id' in v for v in items)
                else (lambda v: utf16(js_json(v)))
            )
            return sorted(items, key=key)
        if isinstance(value, dict):
            return {
                k: canonical(v) for k, v in sorted(value.items(), key=lambda item: utf16(item[0]))
            }
        return value

    return js_json(
        canonical(
            {
                k: v
                for k, v in document.items()
                if k not in ('views', 'findings', 'versions', 'estimates', 'assessments')
            }
        )
    )


def metric(
    identifier, name, value, unit, formula, inputs=None, assumptions=(), limitations=(), sources=()
):
    known = value is not None and math.isfinite(value)
    result = {
        'id': identifier,
        'name': name,
        'unit': unit,
        'status': 'known' if known else 'unknown',
        'formula': formula,
        'inputs': {
            k: v for k, v in (inputs or {}).items() if type(v) in (int, float) and math.isfinite(v)
        },
        'assumptions': list(dict.fromkeys(assumptions)),
        'limitations': list(dict.fromkeys(limitations)),
        'sources': list(dict.fromkeys(sources)),
    }
    if known:
        result['value'] = value
    elif value is not None:
        result['limitations'] = list(
            dict.fromkeys(
                [
                    *result['limitations'],
                    'Calculation exceeded the finite numerical range. Revise input magnitudes.',
                ]
            )
        )
    return result


def report_for(d, scenario, kind):
    return {
        'engineVersion': ENGINE_VERSION,
        'modelVersion': '1.0',
        'fingerprint': fingerprint(d),
        'scenarioId': scenario['id'],
        'scenarioName': scenario['name'],
        'kind': kind,
        'status': 'complete',
        'metrics': [],
        'nodes': [],
        'coverage': [],
        'assumptions': [],
    }


def scenario_for(d, identifier):
    validate_document(d)
    scenario = next((s for s in d['scenarios'] if s['id'] == identifier), None)
    if scenario is None:
        raise ValueError(f'Unknown scenario {identifier}.')
    return scenario


def rate_for(traffic, scenario):
    workload = traffic['workload']
    base = (
        workload['requestsPerSecond']
        if workload['kind'] == 'rate'
        else workload['dailyActiveUsers'] * workload['requestsPerUserPerDay'] / 86400
    )
    try:
        rate = (
            base
            * traffic['peakMultiplier']
            * (1 + scenario['growthPercentPerMonth'] / 100) ** scenario['growthMonths']
        )
    except OverflowError:
        rate = math.inf
    if not math.isfinite(rate):
        raise ValueError(
            'Workload growth or peak multiplication exceeds the finite numerical range. Reduce the scenario values.'
        )
    return rate


def mean_service_ms(profile):
    distribution = profile.get('serviceTime')
    if not distribution:
        return None
    base = (
        sum(distribution['samplesMs']) / len(distribution['samplesMs'])
        if distribution['kind'] == 'empirical'
        else distribution['meanMs']
    )
    if (
        profile['serviceTimeScope'] == 'non-cpu'
        and profile.get('cpuSecondsPerOperation')
        and profile.get('cpuCores')
    ):
        base += (
            profile['cpuSecondsPerOperation']
            / (profile['cpuCores'] / math.ceil(profile['cpuCores']))
            * 1000
        )
    return base


def policy_for(document, edge_id, traffic_id):
    return next(
        (
            p
            for p in document['flowPolicies']
            if p['edgeId'] == edge_id and p.get('trafficClassId') == traffic_id
        ),
        None,
    ) or next(
        (
            p
            for p in document['flowPolicies']
            if p['edgeId'] == edge_id and not p.get('trafficClassId')
        ),
        None,
    )


def flow_fraction(document, policy, read):
    operation = policy['operation']
    if (operation == 'read' and not read) or (operation == 'write' and read):
        return 0
    if operation in ('cache-miss', 'cache-aside'):
        if not read:
            return policy['fraction'] if operation == 'cache-aside' else 0
        profile = next(
            (
                p
                for p in document['performanceProfiles']
                if p['nodeId'] == policy.get('cacheNodeId')
            ),
            {},
        )
        if 'cacheHitRatio' not in profile:
            return None
        return policy['fraction'] * (1 - profile['cacheHitRatio'])
    return policy['fraction']


def topology_order(document):
    indegree = {n['id']: 0 for n in document['nodes']}
    outgoing = {}
    for edge in document['edges']:
        source, target = edge['source']['nodeId'], edge['target']['nodeId']
        indegree[target] += 1
        outgoing.setdefault(source, []).append(target)
    ready = [k for k, count in indegree.items() if count == 0]
    order = []
    for identifier in ready:
        order.append(identifier)
        for target in outgoing.get(identifier, []):
            indegree[target] -= 1
            if not indegree[target]:
                ready.append(target)
    return order if len(order) == len(document['nodes']) else None


def slots(profile):
    return profile['concurrency'] * (
        profile['replicas']
        if profile['model'] != 'database' and profile['scaling'] == 'linear'
        else 1
    )


def mmc(rate, mean_seconds, servers):
    if (
        not math.isfinite(rate)
        or rate < 0
        or not math.isfinite(mean_seconds)
        or mean_seconds <= 0
        or type(servers) not in (int, float)
        or servers % 1
        or not 1 <= servers <= 9007199254740991
    ):
        raise ValueError(
            'Queueing inputs require a finite nonnegative rate, positive service time and positive integer server count.'
        )
    demand = rate * mean_seconds
    if not math.isfinite(demand):
        raise ValueError('Offered service demand exceeds the finite numerical range.')
    rho = demand / servers
    if rho >= 1 or servers > 100000:
        return {'utilization': rho}
    erlang_b = 1
    for k in range(1, int(servers) + 1):
        erlang_b = demand * erlang_b / (k + demand * erlang_b)
    erlang_c = erlang_b / (1 - rho + rho * erlang_b)
    wait = 0 if rate == 0 else erlang_c * mean_seconds / (servers * (1 - rho))
    return {'utilization': rho, 'waitSeconds': wait, 'meanSeconds': wait + mean_seconds}


def curve_latency(profile, rate):
    curve = profile['capacityCurve']
    if not curve or rate < curve[0]['requestsPerSecond'] or rate > curve[-1]['requestsPerSecond']:
        return None
    for a, b in zip(curve, curve[1:]):
        if rate <= b['requestsPerSecond']:
            return a['meanLatencyMs'] + (b['meanLatencyMs'] - a['meanLatencyMs']) * (
                rate - a['requestsPerSecond']
            ) / (b['requestsPerSecond'] - a['requestsPerSecond'])
    return curve[0]['meanLatencyMs']


def analyze_topology(document, scenario_id):
    scenario = scenario_for(document, scenario_id)
    report = report_for(document, scenario, 'analytical')
    order = topology_order(document)
    if order is None:
        report['status'] = 'partial'
        report['coverage'].append(
            {
                'message': 'Topology contains a feedback cycle. This behavior model supports directed acyclic paths and bounded policy retries, not recursive routing.'
            }
        )
        return report
    rates = {
        n['id']: {'reads': 0, 'writes': 0, 'bytes': 0, 'storage': 0} for n in document['nodes']
    }
    unknown_storage = set()
    outgoing = {
        n['id']: [e for e in document['edges'] if e['source']['nodeId'] == n['id']]
        for n in document['nodes']
    }
    profiles = {p['nodeId']: p for p in document['performanceProfiles']}
    for traffic in scenario['trafficClasses']:
        for read in (True, False):
            arrivals = {
                traffic['entryNodeId']: rate_for(traffic, scenario)
                * (traffic['readFraction'] if read else 1 - traffic['readFraction'])
            }
            for node_id in order:
                rate = arrivals.get(node_id, 0)
                if not rate:
                    continue
                demand = rates[node_id]
                demand['reads' if read else 'writes'] += rate
                if not read:
                    if 'objectBytes' not in traffic or 'retentionDays' not in traffic:
                        unknown_storage.add(node_id)
                    else:
                        demand['storage'] += (
                            rate * traffic['objectBytes'] * traffic['retentionDays'] * 86400
                        )
                demand['bytes'] += rate * (
                    traffic.get('payloadBytes', 0) + traffic.get('responseBytes', 0)
                )
                for edge in outgoing[node_id]:
                    policy = policy_for(document, edge['id'], traffic['id'])
                    if not policy:
                        report['coverage'].append(
                            {
                                'nodeId': node_id,
                                'edgeId': edge['id'],
                                'message': f'Missing calls and routing policy for {traffic["name"]}; downstream demand is unknown.',
                            }
                        )
                        continue
                    fraction = flow_fraction(document, policy, read)
                    if fraction is None:
                        report['coverage'].append(
                            {
                                'edgeId': edge['id'],
                                'message': 'Cache-miss routing has no hit-ratio evidence.',
                            }
                        )
                        continue
                    retry_factor = sum(
                        policy['retryProbability'] ** i for i in range(policy['maxRetries'] + 1)
                    )
                    next_ = rate * fraction * policy['callsPerOperation'] * retry_factor
                    target = edge['target']['nodeId']
                    arrivals[target] = arrivals.get(target, 0) + next_
                    if policy.get('linkBytesPerSecond'):
                        value = (
                            next_
                            * (traffic['payloadBytes'] + traffic['responseBytes'])
                            / policy['linkBytesPerSecond']
                            if 'payloadBytes' in traffic and 'responseBytes' in traffic
                            else None
                        )
                        report['metrics'].append(
                            metric(
                                f'{traffic["id"]}:{str(read).lower()}:{edge["id"]}:link-utilization',
                                f'{edge["label"] or edge["id"]} · link utilization',
                                value,
                                'ratio',
                                'offered operations × payload / declared link bandwidth',
                                {'rate': next_, 'bandwidth': policy['linkBytesPerSecond']},
                                [policy['assumption']],
                            )
                        )
    unknown = set()
    for issue in report['coverage']:
        if issue.get('edgeId'):
            unknown.add(
                next(e for e in document['edges'] if e['id'] == issue['edgeId'])['target']['nodeId']
            )
    for node_id in order:
        if node_id in unknown:
            unknown.update(e['target']['nodeId'] for e in outgoing[node_id])
    components = {c['id']: c for c in document['components']}
    for node in document['nodes']:
        category = components[node['componentId']]['category']
        if category == 'boundary':
            continue
        node_id, demand = node['id'], rates[node['id']]
        rate = demand['reads'] + demand['writes']
        profile = profiles.get(node_id)
        metrics = [
            metric(
                'arrival',
                'Offered demand',
                None if node_id in unknown else rate,
                'ops/s',
                'Σ external arrivals + upstream calls × routing × bounded retry factor',
                {'reads': demand['reads'], 'writes': demand['writes']},
                ['Downstream offered demand is propagated independently of admission limits.'],
                ['An upstream routing policy is missing.'] if node_id in unknown else [],
            )
        ]
        if node_id in unknown:
            report['nodes'].append({'nodeId': node_id, 'metrics': metrics, 'bottleneck': False})
            continue
        if not profile and category != 'client':
            metrics.append(
                metric(
                    'utilization',
                    'Service-slot utilization',
                    None,
                    'ratio',
                    'A registered performance profile is required.',
                    {},
                    [],
                    ['No component performance evidence.'],
                )
            )
            report['coverage'].append(
                {
                    'nodeId': node_id,
                    'message': 'No registered behavior profile or performance evidence. Capacity is unknown.',
                }
            )
        if profile:
            mean = mean_service_ms(profile)
            provenance = [profile['provenance']['source'], profile['provenance']['context']]
            assumptions = [
                'Measured input within its recorded context.'
                if profile['provenance']['kind'] == 'measured'
                else f'{profile["provenance"]["kind"]} input; not measured production performance.'
            ]

            def m(
                identifier,
                label,
                value,
                unit,
                formula,
                inputs=None,
                extra_assumptions=None,
                limitations=(),
            ):
                return metric(
                    identifier,
                    label,
                    value,
                    unit,
                    formula,
                    inputs,
                    assumptions if extra_assumptions is None else extra_assumptions,
                    limitations,
                    provenance,
                )

            if mean is not None and profile['model'] not in ('queue', 'router'):
                servers = slots(profile)
                separate = profile['model'] == 'database' and profile['readReplicas'] > 0
                equivalent = (
                    max(demand['writes'], demand['reads'] / profile['readReplicas'])
                    if separate
                    else rate
                )
                q = mmc(rate, mean / 1000, servers)
                if separate:
                    read_q, write_q = (
                        mmc(demand['reads'], mean / 1000, servers * profile['readReplicas']),
                        mmc(demand['writes'], mean / 1000, servers),
                    )
                    q = {'utilization': max(read_q['utilization'], write_q['utilization'])}
                    for key in ('waitSeconds', 'meanSeconds'):
                        if key in read_q and key in write_q:
                            q[key] = (
                                (read_q[key] * demand['reads'] + write_q[key] * demand['writes'])
                                / rate
                                if rate
                                else (0 if key == 'waitSeconds' else mean / 1000)
                            )
                metrics.append(
                    m(
                        'utilization',
                        'Service-slot utilization',
                        q['utilization'],
                        'ratio',
                        'offered rate × mean service seconds / service slots',
                        {'offered': equivalent, 'meanMs': mean, 'servers': servers},
                        assumptions
                        + (
                            [
                                'Read replicas are modeled as a separate balanced read pool; writes remain on the primary.'
                            ]
                            if separate
                            else []
                        ),
                        ['Service-slot utilization is not CPU utilization.'],
                    )
                )
                poisson = all(
                    t['arrivals'] == 'poisson' and not t['bursts']
                    for t in scenario['trafficClasses']
                )
                exponential = profile.get('serviceTime', {}).get(
                    'kind'
                ) == 'exponential' and not profile.get('cpuSecondsPerOperation')
                wait = m(
                    'queue-wait',
                    'Mean queue wait',
                    q['waitSeconds'] * 1000
                    if poisson and exponential and 'waitSeconds' in q
                    else None,
                    'ms',
                    'Erlang-C × mean service time / (servers × (1 − utilization))',
                    {'offered': equivalent, 'servers': servers, 'meanMs': mean},
                    [
                        'M/M/c: Poisson arrivals, independent exponential service, FCFS, infinite buffer, stationary load.'
                    ],
                    [
                        'Transformed downstream arrivals may violate independence; validate using simulation.'
                    ],
                )
                if q['utilization'] >= 1:
                    wait['status'] = 'unstable'
                metrics.append(wait)
                latency = (
                    curve_latency(profile, rate)
                    if profile['capacityCurve']
                    else q['meanSeconds'] * 1000
                    if poisson and exponential and 'meanSeconds' in q
                    else None
                )
                metrics.append(
                    m(
                        'mean-latency',
                        'Local mean latency',
                        latency,
                        'ms',
                        'Linear interpolation within measured curve range'
                        if profile['capacityCurve']
                        else 'mean queue wait + mean local service time',
                        {'rate': rate, 'meanMs': mean},
                        limitations=[
                            'Local latency excludes downstream dependencies; end-to-end latency requires simulation.'
                        ],
                    )
                )
                cpu_limited = (
                    profile.get('cpuSecondsPerOperation')
                    and profile.get('cpuCores')
                    and rate * profile['cpuSecondsPerOperation'] / profile['cpuCores']
                    > profile['targetUtilization']
                )
                replicas = (
                    max(
                        1,
                        math.ceil(
                            equivalent
                            * mean
                            / 1000
                            / (profile['concurrency'] * profile['targetUtilization'])
                        ),
                    )
                    if profile['scaling'] == 'linear'
                    and profile['model'] != 'database'
                    and not cpu_limited
                    else None
                )
                metrics.append(
                    m(
                        'required-replicas',
                        'Required replicas',
                        replicas
                        if replicas is not None and replicas <= profile['maxReplicas']
                        else None,
                        'replicas',
                        'ceil(rate × mean service seconds / (concurrency × target utilization))',
                        {'rate': equivalent, 'target': profile['targetUtilization']},
                        [
                            'Requires declared homogeneous linear scaling; excludes shared bottlenecks.'
                        ],
                        ['No solution within configured replica bounds.']
                        if replicas and replicas > profile['maxReplicas']
                        else [],
                    )
                )
            elif profile['model'] not in ('router', 'queue'):
                metrics.append(
                    m(
                        'mean-latency',
                        'Local measured latency',
                        curve_latency(profile, rate),
                        'ms',
                        'Linear interpolation within measured curve range',
                        {'rate': rate},
                        limitations=[
                            'Curve values are never extrapolated. Utilization and service times cannot be inferred from end-to-end latency.'
                        ],
                    )
                )
                if not profile['capacityCurve']:
                    report['coverage'].append(
                        {
                            'nodeId': node_id,
                            'message': 'Service time or measured capacity curve is required.',
                        }
                    )
            if 'cpuSecondsPerOperation' in profile and profile.get('cpuCores'):
                metrics.append(
                    m(
                        'cpu',
                        'CPU utilization',
                        rate * profile['cpuSecondsPerOperation'] / profile['cpuCores'],
                        'ratio',
                        'rate × CPU seconds per operation / allocated cores',
                        {
                            'rate': rate,
                            'demand': profile['cpuSecondsPerOperation'],
                            'cores': profile['cpuCores'],
                        },
                    )
                )
            if profile.get('storageBytes'):
                metrics.append(
                    m(
                        'storage',
                        'Retained new-write utilization (lower bound)',
                        None
                        if node_id in unknown_storage
                        else demand['storage'] / profile['storageBytes'],
                        'ratio',
                        'retained write bytes / allocated storage bytes',
                        {'retainedBytes': demand['storage'], 'capacity': profile['storageBytes']},
                        [
                            'Object creation workload. Excludes preexisting data; this is a lower bound, not a claim of free storage. Storage overhead is not inferred.'
                        ],
                    )
                )
            if profile['model'] == 'cache':
                metrics.append(
                    m(
                        'cache-hit',
                        'Declared cache hit ratio',
                        profile.get('cacheHitRatio'),
                        'ratio',
                        'User supplied measured or assumed ratio',
                        limitations=['Hit ratio is not derived from cache memory.'],
                    )
                )
            if profile['model'] == 'queue':
                fraction, known, consumers = 1, True, 0
                for edge in outgoing[node_id]:
                    consumer = profiles.get(edge['target']['nodeId'])
                    service = mean_service_ms(consumer) if consumer else None
                    consumers += 1
                    if not consumer or not service:
                        known = False
                    else:
                        offered = rates[edge['target']['nodeId']]
                        demand_rate = offered['reads'] + offered['writes']
                        capacity = slots(consumer) * 1000 / service
                        if consumer.get('cpuSecondsPerOperation') and consumer.get('cpuCores'):
                            capacity = min(
                                capacity, consumer['cpuCores'] / consumer['cpuSecondsPerOperation']
                            )
                        if demand_rate:
                            fraction = min(fraction, capacity / demand_rate)
                consumption = rate * min(1, fraction)
                metrics.append(
                    m(
                        'backlog-growth',
                        'Backlog growth',
                        max(0, rate - consumption) if known and consumers else None,
                        'messages/s',
                        'max(0, producer rate − consumer service capacity)',
                        {'offered': rate, 'consumerCapacity': consumption},
                        [
                            'Offered work shares declared consumer pools. The limiting consumer completion fraction bounds broker acknowledgement capacity.'
                        ],
                        [
                            'Approximation assumes shared FCFS workload and fixed routing. Use simulation for independent broadcast-group dynamics, retries and retention.'
                        ],
                    )
                )
        report['nodes'].append(
            {
                'nodeId': node_id,
                'metrics': metrics,
                'bottleneck': any(
                    m['id'] in ('utilization', 'cpu', 'storage') and m.get('value', -1) >= 1
                    for m in metrics
                ),
            }
        )
    report['assumptions'] = [
        'Analytical offered-load model. Finite queues, bursts, joins and timeouts require the discrete-event engine.',
        scenario['assumptions'],
        'Analytical rates exclude additional time-varying burst intervals. Inspect the simulation for transient demand and recovery.',
    ]
    for item in report['metrics'] + [m for n in report['nodes'] for m in n['metrics']]:
        item['assumptions'].extend(report['assumptions'])
    if report['coverage']:
        report['status'] = 'partial'
    return report
