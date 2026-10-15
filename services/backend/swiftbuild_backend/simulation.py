"""Bounded discrete-event capacity simulation, with offline-engine event ordering."""

import copy
import heapq
import math
import time

from .capacity import (
    mean_service_ms,
    metric,
    policy_for,
    rate_for,
    report_for,
    scenario_for,
    slots,
    topology_order,
)
from .domain import validate_document
from .random import random_for
from .serialization import utf16


def average(values):
    return sum(values) / len(values) if values else None


def percentile(values, q):
    return sorted(values)[max(0, math.ceil(q * len(values)) - 1)] if values else None


def sample_service(profile, random):
    d = profile.get('serviceTime')
    if not d:
        return None
    if d['kind'] == 'constant':
        return d['meanMs'] / 1000
    if d['kind'] == 'exponential':
        return -math.log(1 - random()) * d['meanMs'] / 1000
    return d['samplesMs'][math.floor(random() * len(d['samplesMs']))] / 1000


def next_arrival(traffic, scenario, from_, end, random):
    hazard = -math.log(1 - random()) if traffic['arrivals'] == 'poisson' else 1
    at = from_
    boundaries = sorted(
        {
            v
            for b in traffic['bursts']
            for v in (b['startSeconds'], b['startSeconds'] + b['durationSeconds'])
            if from_ < v < end
        }
    )
    for boundary in boundaries + [end]:
        burst = next(
            (
                b
                for b in traffic['bursts']
                if b['startSeconds'] <= at < b['startSeconds'] + b['durationSeconds']
            ),
            None,
        )
        rate = rate_for(traffic, scenario) * (burst['multiplier'] if burst else 1)
        available = (boundary - at) * rate
        if rate > 0 and hazard < available:
            return at + hazard / rate
        hazard -= available
        at = boundary
    return None


def run_replication(document, scenario, options, control, replication, remaining, deadline):
    random = random_for(options['seed'], replication)
    events = []
    sequence, now, processed = 0, 0, 0
    cancelled, budget_reached = False, False
    end, warmup = options['warmupSeconds'] + options['durationSeconds'], options['warmupSeconds']
    counters = (
        'busy',
        'busyReads',
        'busyWrites',
        'readBusySeconds',
        'writeBusySeconds',
        'deadLettered',
        'cpuBusy',
        'cpuBusySeconds',
        'peakMemoryBytes',
        'arrived',
        'observedArrivals',
        'observedCompletions',
        'completed',
        'failed',
        'dropped',
        'busySeconds',
        'lastTime',
        'peakQueue',
        'queueDepth',
    )
    states = {
        n['id']: {
            **dict.fromkeys(counters, 0),
            'cpuPending': [],
            'pending': [],
            'waitMs': [],
            'latenciesMs': [],
        }
        for n in document['nodes']
    }
    profiles = {p['nodeId']: p for p in document['performanceProfiles']}
    components = {c['id']: c for c in document['components']}
    categories = {n['id']: components[n['componentId']]['category'] for n in document['nodes']}
    accounting = dict.fromkeys(
        ('offered', 'admitted', 'completed', 'failed', 'dropped', 'outstanding'), 0
    )
    latencies, series, links = [], [], {}
    traffic_results = {
        t['id']: {'latencies': [], 'completed': 0} for t in scenario['trafficClasses']
    }
    measured_completed, deadline_violations = 0, 0

    def schedule(at, action):
        nonlocal sequence, budget_reached
        if at > end:
            return
        if sequence >= remaining or len(events) >= 100000:
            budget_reached = True
            return
        heapq.heappush(events, (at, sequence, action))
        sequence += 1

    def track_busy(state):
        duration = max(0, now - max(state['lastTime'], warmup))
        state['readBusySeconds'] += state['busyReads'] * duration
        state['writeBusySeconds'] += state['busyWrites'] * duration
        state['cpuBusySeconds'] += state['cpuBusy'] * duration
        state['busySeconds'] += state['busy'] * duration
        state['lastTime'] = now

    def route(node_id, job, callback):
        nonlocal budget_reached
        policies = [
            (edge, policy_for(document, edge['id'], job['traffic']['id']))
            for edge in document['edges']
            if edge['source']['nodeId'] == node_id
        ]
        selected, cache_outcomes, competing = [], {}, {}
        for edge, p in policies:
            if not p:
                callback('failed')
                return
            if (p['operation'] == 'read' and not job['read']) or (
                p['operation'] == 'write' and job['read']
            ):
                continue
            if p['operation'] in ('cache-miss', 'cache-aside') and job['read']:
                cache_id = p.get('cacheNodeId')
                if cache_id not in cache_outcomes:
                    cache_outcomes[cache_id] = random() >= profiles[cache_id]['cacheHitRatio']
                if not cache_outcomes[cache_id]:
                    continue
            if p['operation'] == 'cache-miss' and not job['read']:
                continue
            if p['routing'] == 'exclusive' or (
                categories[node_id] == 'messaging' and p['delivery'] == 'competing'
            ):
                key = (p['group'], p['operation'], p.get('cacheNodeId'))
                competing.setdefault(key, []).append((edge, p))
                continue
            calls = math.floor(p['callsPerOperation'])
            if random() < p['callsPerOperation'] - calls:
                calls += 1
            for _ in range(calls):
                if len(selected) >= 100000:
                    budget_reached = True
                    return
                if random() < p['fraction']:
                    selected.append(
                        {'edgeId': edge['id'], 'target': edge['target']['nodeId'], 'policy': p}
                    )
        for group in competing.values():
            draw, cumulative = random(), 0
            for edge, p in group:
                cumulative += p['fraction']
                if draw < cumulative:
                    calls = math.floor(p['callsPerOperation'])
                    if random() < p['callsPerOperation'] - calls:
                        calls += 1
                    selected.extend(
                        {'edgeId': edge['id'], 'target': edge['target']['nodeId'], 'policy': p}
                        for _ in range(calls)
                    )
                    break
        groups = {}
        for item in selected:
            if (
                item['policy']['execution'] == 'async'
                and profiles.get(node_id, {}).get('model') != 'queue'
            ):
                invoke(item, job, lambda outcome: None)
            else:
                groups.setdefault(item['policy']['order'], []).append(item)
        stages = sorted(groups.items())

        def run_stage(index):
            if index >= len(stages):
                callback('completed')
                return
            items = stages[index][1]
            sequential = [i for i in items if i['policy']['execution'] == 'sequential']
            parallel = [i for i in items if i['policy']['execution'] in ('parallel', 'async')]

            def run_sequential(i):
                if i >= len(sequential):
                    if not parallel:
                        run_stage(index + 1)
                        return
                    left, failed = len(parallel), False

                    def finished(outcome):
                        nonlocal left, failed
                        if outcome != 'completed':
                            failed = True
                        left -= 1
                        if left == 0:
                            callback('failed') if failed else run_stage(index + 1)

                    for item in parallel:
                        invoke(item, job, finished)
                    return

                def next_(outcome):
                    run_sequential(i + 1) if outcome == 'completed' else callback(outcome)

                invoke(sequential[i], job, next_)

            run_sequential(0)

        run_stage(0)

    def invoke(item, parent, done):
        p = item['policy']

        def attempt(retry):
            settled = False

            def finish(result):
                nonlocal settled
                if settled:
                    return
                settled = True
                outcome = (
                    'failed'
                    if result == 'completed' and random() < p['retryProbability']
                    else result
                )
                if outcome != 'completed' and retry < p['maxRetries']:
                    schedule(now + p['retryBackoffMs'] / 1000, lambda: attempt(retry + 1))
                else:
                    done(outcome)

            dispatch = now + p['networkLatencyMs'] / 1000
            if p.get('linkBytesPerSecond'):
                dispatch = (
                    max(dispatch, links.get(item['edgeId'], 0))
                    + (
                        parent['traffic'].get('payloadBytes', 0)
                        + parent['traffic'].get('responseBytes', 0)
                    )
                    / p['linkBytesPerSecond']
                )
                links[item['edgeId']] = dispatch
            schedule(
                dispatch, lambda: arrive(item['target'], {**parent, 'arrived': now, 'done': finish})
            )
            if p.get('timeoutMs'):
                schedule(now + p['timeoutMs'] / 1000, lambda: finish('failed'))

        attempt(0)

    def arrive(node_id, incoming):
        original_done, settled = incoming['done'], False

        def done(outcome):
            nonlocal settled
            if not settled:
                settled = True
                original_done(outcome)

        job = {**incoming, 'done': done}
        state, profile = states[node_id], profiles.get(node_id)
        state['arrived'] += 1
        if now >= warmup:
            state['observedArrivals'] += 1
        if categories[node_id] == 'client' or (profile and profile['model'] == 'router'):
            route(node_id, job, done)
            return
        if not profile:
            state['failed'] += 1
            done('failed')
            return
        if profile['model'] == 'queue':
            queue = profile['queue']
            if state['queueDepth'] >= queue['bufferMessages']:
                state['dropped'] += 1
                done('dropped')
                return
            state['queueDepth'] += 1
            state['peakQueue'] = max(state['peakQueue'], state['queueDepth'])
            acked = False

            def ack():
                nonlocal acked
                if not acked:
                    acked = True
                    state['queueDepth'] -= 1

            if queue['acknowledgement'] == 'on-admission':
                ack()

            def expire():
                if not acked:
                    ack()
                    state['dropped'] += 1
                    done('dropped')

            schedule(now + queue['retentionSeconds'], expire)
            queued_at = now

            def queued_done(outcome):
                expired = acked and queue['acknowledgement'] == 'on-completion'
                ack()
                if expired:
                    done('dropped')
                    return
                if outcome == 'completed':
                    state['completed'] += 1
                    if now >= warmup:
                        state['observedCompletions'] += 1
                elif queue['deadLetter']:
                    state['deadLettered'] += 1
                else:
                    state['failed'] += 1
                if queued_at >= warmup:
                    state['latenciesMs'].append((now - queued_at) * 1000)
                done(outcome)

            route(node_id, job, queued_done)
            return
        if not profile.get('serviceTime'):
            state['failed'] += 1
            done('failed')
            return
        state['pending'].append(job)
        drain(node_id)
        state['peakQueue'] = max(state['peakQueue'], len(state['pending']))

    def drain(node_id):
        state, profile = states[node_id], profiles[node_id]
        separate = profile['model'] == 'database' and profile['readReplicas'] > 0

        def start(job):
            track_busy(state)
            state['busy'] += 1
            state['peakMemoryBytes'] = max(
                state['peakMemoryBytes'], state['busy'] * profile.get('memoryBytesPerOperation', 0)
            )
            state['busyReads' if job['read'] else 'busyWrites'] += 1
            if now >= warmup:
                state['waitMs'].append((now - job['arrived']) * 1000)
            duration = sample_service(profile, random)

            def finish_local():
                track_busy(state)
                state['busy'] -= 1
                state['busyReads' if job['read'] else 'busyWrites'] -= 1

                def routed(outcome):
                    if outcome == 'completed':
                        state['completed'] += 1
                        if now >= warmup:
                            state['observedCompletions'] += 1
                    else:
                        state['failed'] += 1
                    if job['arrived'] >= warmup:
                        state['latenciesMs'].append((now - job['arrived']) * 1000)
                    job['done'](outcome)

                route(node_id, job, routed)
                drain(node_id)

            if (
                profile.get('cpuSecondsPerOperation')
                and profile.get('cpuCores')
                and profile['serviceTimeScope'] == 'non-cpu'
            ):
                state['cpuPending'].append(lambda: schedule(now + duration, finish_local))
                drain_cpu(node_id)
            else:
                schedule(now + duration, finish_local)

        while state['pending']:
            if (
                profile.get('memoryBytesPerOperation')
                and profile.get('memoryBytes')
                and (state['busy'] + 1) * profile['memoryBytesPerOperation']
                > profile['memoryBytes']
            ):
                break
            if separate:
                index = next(
                    (
                        i
                        for i, job in enumerate(state['pending'])
                        if (
                            state['busyReads'] < profile['concurrency'] * profile['readReplicas']
                            if job['read']
                            else state['busyWrites'] < profile['concurrency']
                        )
                    ),
                    -1,
                )
            else:
                index = 0 if state['busy'] < slots(profile) else -1
            if index < 0:
                break
            start(state['pending'].pop(index))

    def drain_cpu(node_id):
        state, profile = states[node_id], profiles[node_id]
        processors = math.ceil(profile['cpuCores'])
        core_fraction = profile['cpuCores'] / processors

        def start(continuation):
            track_busy(state)
            state['cpuBusy'] += 1

            def finish():
                track_busy(state)
                state['cpuBusy'] -= 1
                continuation()
                drain_cpu(node_id)

            schedule(now + profile['cpuSecondsPerOperation'] / core_fraction, finish)

        while state['cpuBusy'] < processors and state['cpuPending']:
            start(state['cpuPending'].pop(0))

    def offer(traffic):
        accounting['offered'] += 1
        accounting['admitted'] += 1
        accounting['outstanding'] += 1
        started, finished = now, False

        def done(outcome):
            nonlocal finished, measured_completed, deadline_violations
            if finished:
                return
            finished = True
            accounting['outstanding'] -= 1
            accounting[outcome] += 1
            if outcome == 'dropped':
                accounting['admitted'] -= 1
            if outcome == 'completed' and now >= warmup:
                measured_completed += 1
                traffic_results[traffic['id']]['completed'] += 1
            if outcome == 'completed' and started >= warmup:
                ms = (now - started) * 1000
                latencies.append(ms)
                traffic_results[traffic['id']]['latencies'].append(ms)
                if any(
                    t['metric'] == 'deadline'
                    and (not t.get('trafficClassId') or t['trafficClassId'] == traffic['id'])
                    and ms > t['value']
                    for t in scenario['targets']
                ):
                    deadline_violations += 1

        arrive(
            traffic['entryNodeId'],
            {
                'traffic': traffic,
                'read': random() < traffic['readFraction'],
                'arrived': now,
                'done': done,
            },
        )
        next_ = next_arrival(traffic, scenario, now, end, random)
        if next_ is not None:
            schedule(next_, lambda: offer(traffic))

    for traffic in scenario['trafficClasses']:
        next_ = next_arrival(traffic, scenario, 0, end, random)
        if next_ is not None:
            schedule(next_, lambda traffic=traffic: offer(traffic))

    def sample():
        series.append(
            {
                'seconds': now - warmup,
                'completed': measured_completed,
                'outstanding': accounting['outstanding'],
                'queueDepth': sum(s['queueDepth'] + len(s['pending']) for s in states.values()),
                'dropped': accounting['dropped'],
            }
        )

    series_step, at = max(1, options['durationSeconds'] / 120), warmup
    while at <= end:
        schedule(at, sample)
        at += series_step
    while events and not budget_reached and processed < remaining and time.monotonic() < deadline:
        if control.get('shouldCancel', lambda: False)():
            cancelled = True
            break
        now, _, action = heapq.heappop(events)
        action()
        processed += 1
    ended = not events and not budget_reached
    if ended:
        now = end
    for state in states.values():
        track_busy(state)
    return {
        'traffic': traffic_results,
        'accounting': accounting,
        'states': states,
        'series': series,
        'latencies': latencies,
        'measuredCompleted': measured_completed,
        'deadlineViolations': deadline_violations,
        'events': processed,
        'observedSeconds': max(0, now - warmup),
        'ended': ended,
        'cancelled': cancelled,
    }


def simulation_coverage(document, scenario):
    coverage = []
    if topology_order(document) is None:
        coverage.append(
            {
                'message': 'Recursive topology cycles are unsupported. Use bounded retry policies instead.'
            }
        )
    components = {c['id']: c for c in document['components']}
    profiles = {p['nodeId']: p for p in document['performanceProfiles']}
    for node in document['nodes']:
        category, p = components[node['componentId']]['category'], profiles.get(node['id'], {})

        def issue(message):
            coverage.append({'nodeId': node['id'], 'message': message})

        if category not in ('client', 'boundary') and (
            not p or (p['model'] not in ('router', 'queue') and not p.get('serviceTime'))
        ):
            issue(
                'A service-time distribution is required for simulation. Capacity curves alone do not identify a service distribution.'
            )
        if p.get('queue', {}).get('initialMessages'):
            issue(
                'Initial queue messages require traffic-class attribution. This model does not invent a workload for unattributed backlog.'
            )
        if p.get('cpuSecondsPerOperation') and (
            not p.get('cpuCores') or p['serviceTimeScope'] != 'non-cpu'
        ):
            issue(
                'Coupled CPU simulation requires allocated cores and explicitly measured/assumed non-CPU delay. Total latency cannot identify CPU and I/O phases.'
            )
        if p.get('memoryBytesPerOperation') and (
            not p.get('memoryBytes') or p['memoryBytesPerOperation'] > p['memoryBytes']
        ):
            issue(
                'Memory allocation is missing or cannot admit one operation under the declared per-operation memory demand.'
            )
        edges = [e for e in document['edges'] if e['source']['nodeId'] == node['id']]
        if p.get('model') == 'queue' and not edges:
            issue('Queue delivery requires an explicit consumer connection and policy.')
        groups = {}
        for edge in edges:
            for traffic in scenario['trafficClasses']:
                policy = policy_for(document, edge['id'], traffic['id'])
                if (
                    policy
                    and policy.get('linkBytesPerSecond')
                    and ('payloadBytes' not in traffic or 'responseBytes' not in traffic)
                ):
                    coverage.append(
                        {
                            'edgeId': edge['id'],
                            'message': f'Link serialization requires declared request and response payload sizes for {traffic["name"]}.',
                        }
                    )
                if not policy:
                    coverage.append(
                        {
                            'edgeId': edge['id'],
                            'message': f'Missing flow policy for {traffic["name"]}.',
                        }
                    )
                if policy and (
                    policy['routing'] == 'exclusive'
                    or (p.get('model') == 'queue' and policy['delivery'] == 'competing')
                ):
                    key = (
                        traffic['id'],
                        policy['group'],
                        policy['operation'],
                        policy.get('cacheNodeId'),
                    )
                    groups[key] = groups.get(key, 0) + policy['fraction']
        if any(abs(total - 1) > 1e-9 for total in groups.values()):
            issue(
                'Competing consumer fractions must sum to one within each traffic class and group.'
            )
    return coverage


def simulate_topology(document, scenario_id, control=None):
    control = control or {}
    scenario = copy.deepcopy(scenario_for(document, scenario_id))
    document = copy.deepcopy(document)
    for key in ('nodes', 'edges', 'performanceProfiles'):
        document[key].sort(key=lambda item: utf16(item['id']))
    for p in document['performanceProfiles']:
        if p.get('serviceTime', {}).get('kind') == 'empirical':
            p['serviceTime']['samplesMs'].sort()
    scenario['trafficClasses'].sort(key=lambda item: utf16(item['id']))
    document['engineering']['simulation'].update(
        {k: v for k, v in control.items() if k in document['engineering']['simulation']}
    )
    document = validate_document(document)
    options = document['engineering']['simulation']
    report = report_for(document, scenario, 'simulation')
    report['runSettings'] = options
    coverage = simulation_coverage(document, scenario)
    if coverage:
        report['coverage'], report['status'] = coverage, 'partial'
        components = {c['id']: c for c in document['components']}
        for node in document['nodes']:
            if components[node['componentId']]['category'] == 'boundary':
                continue
            limits = [
                c['message']
                for c in coverage
                if c.get('nodeId') == node['id']
                or (not c.get('nodeId') and not c.get('edgeId'))
                or (
                    c.get('edgeId')
                    and any(
                        e['id'] == c['edgeId']
                        and node['id'] in (e['source']['nodeId'], e['target']['nodeId'])
                        for e in document['edges']
                    )
                )
            ]
            report['nodes'].append(
                {
                    'nodeId': node['id'],
                    'bottleneck': False,
                    'metrics': [
                        metric(
                            'arrival',
                            'Observed demand',
                            None,
                            'ops/s',
                            'Not evaluated because the declared model is incomplete.',
                            {},
                            [scenario['assumptions']],
                            limits,
                        ),
                        metric(
                            'utilization',
                            'Service-slot utilization',
                            None,
                            'ratio',
                            'Not evaluated because the declared model is incomplete.',
                            {},
                            [scenario['assumptions']],
                        ),
                    ],
                }
            )
        return report
    replications, used = [], 0
    deadline = time.monotonic() + options['maxWallTimeMs'] / 1000
    for i in range(options['replications']):
        r = run_replication(
            document, scenario, options, control, i, options['maxEvents'] - used, deadline
        )
        replications.append(r)
        used += r['events']
        if not r['ended']:
            report['status'] = 'cancelled' if r['cancelled'] else 'partial'
            report['coverage'].append(
                {
                    'message': 'Simulation cancelled. Partial results are not a completed assessment.'
                    if r['cancelled']
                    else 'Execution budget reached. Increase the budget or reduce the workload/window; results are incomplete.'
                }
            )
            break
    report.update(
        seed=options['seed'],
        replications=len(replications),
        processedEvents=used,
        accounting=replications[0]['accounting'],
        series=replications[0]['series'],
    )
    throughput = [
        r['measuredCompleted'] / r['observedSeconds'] if r['observedSeconds'] else 0
        for r in replications
    ]
    values = [v for r in replications for v in r['latencies']]
    assumptions = [
        scenario['assumptions'],
        'Declared service slots model local processing contention; slots release before downstream dependencies.',
        'Random failures use declared independent probabilities. Timeouts do not cancel downstream work.',
        'Intervals describe simulation sampling uncertainty, not accuracy of the supplied model.',
        'When CPU demand is separately declared, CPU centers execute first and non-CPU delay follows. Declared memory is reserved during local processing, including CPU wait.',
    ]
    report['assumptions'] = assumptions + [
        f'{p["nodeId"]}: {p["provenance"]["kind"]} evidence from {p["provenance"]["source"]}; {p["provenance"]["context"]}. {p["provenance"]["limitations"]}'
        for p in document['performanceProfiles']
    ]
    report['metrics'] = [
        metric(
            'deadline',
            'Maximum observed foreground latency',
            max(values) if values else None,
            'ms',
            'maximum duration among completed observed foreground requests',
            {},
            assumptions,
            [
                'Right-censored, failed and dropped requests prevent a positive strict-deadline assessment.'
            ],
        ),
        metric(
            'throughput',
            'Completed foreground throughput',
            average(throughput),
            'ops/s',
            'completed foreground requests in observation window / observed seconds',
            {},
            assumptions,
        ),
        metric(
            'mean-latency',
            'Mean foreground latency',
            average(values),
            'ms',
            'mean completed request duration',
            {},
            assumptions,
        ),
        metric(
            'p95-latency',
            'P95 foreground latency',
            percentile(values, 0.95),
            'ms',
            'nearest-rank 95th percentile of completed request durations',
            {},
            assumptions,
            ['Only completed requests are sampled; inspect drops and outstanding work.'],
        ),
        metric(
            'p99-latency',
            'P99 foreground latency',
            percentile(values, 0.99),
            'ms',
            'nearest-rank 99th percentile of completed request durations',
            {},
            assumptions,
            ['Small sample counts produce unreliable tail estimates.'],
        ),
        metric(
            'deadline-violations',
            'Completed requests exceeding deadlines',
            sum(r['deadlineViolations'] for r in replications)
            if any(t['metric'] == 'deadline' for t in scenario['targets'])
            else None,
            'requests',
            'count completed requests exceeding the matching deadline',
            {},
            assumptions,
        ),
    ]
    for m in report['metrics']:
        m['inputs'] = {
            'seed': options['seed'],
            'replications': len(replications),
            'warmupSeconds': options['warmupSeconds'],
            'observationSeconds': options['durationSeconds'],
            'processedEvents': used,
            'completedSamples': len(values),
        }
        m['sources'] = [
            f'{p["nodeId"]}: {p["provenance"]["kind"]} · {p["provenance"]["source"]} · {p["provenance"]["recordedAt"]} · {p["provenance"]["context"]}'
            for p in document['performanceProfiles']
        ]
    if report['status'] == 'complete' and len(throughput) >= 5:
        mean = average(throughput)
        variance = sum((v - mean) ** 2 for v in throughput) / (len(throughput) - 1)
        margin = 2.776 * math.sqrt(variance / len(throughput))
        report['metrics'][1]['interval'] = {
            'lower': max(0, mean - margin),
            'upper': mean + margin,
            'level': 0.95,
            'replications': len(throughput),
        }
    report['traffic'] = []
    for traffic in scenario['trafficClasses']:
        traffic_values = [v for r in replications for v in r['traffic'][traffic['id']]['latencies']]
        seconds = sum(r['observedSeconds'] for r in replications)
        report['traffic'].append(
            {
                'trafficClassId': traffic['id'],
                'metrics': [
                    metric(
                        'throughput',
                        f'{traffic["name"]} · completed throughput',
                        sum(r['traffic'][traffic['id']]['completed'] for r in replications)
                        / seconds
                        if seconds
                        else None,
                        'ops/s',
                        'completed traffic-class requests / observed seconds',
                        {},
                        assumptions,
                    ),
                    metric(
                        'mean-latency',
                        f'{traffic["name"]} · mean latency',
                        average(traffic_values),
                        'ms',
                        'mean completed traffic-class duration',
                        {},
                        assumptions,
                    ),
                    metric(
                        'p95-latency',
                        f'{traffic["name"]} · P95 latency',
                        percentile(traffic_values, 0.95),
                        'ms',
                        'nearest-rank 95th percentile for this traffic class',
                        {},
                        assumptions,
                    ),
                    metric(
                        'p99-latency',
                        f'{traffic["name"]} · P99 latency',
                        percentile(traffic_values, 0.99),
                        'ms',
                        'nearest-rank 99th percentile for this traffic class',
                        {},
                        assumptions,
                    ),
                ],
            }
        )
    for node in document['nodes']:
        profile = next(
            (p for p in document['performanceProfiles'] if p['nodeId'] == node['id']), None
        )
        if not profile:
            continue
        states = [r['states'][node['id']] for r in replications]
        seconds = sum(r['observedSeconds'] for r in replications)
        utilization = None
        if seconds:
            if profile['model'] == 'database' and profile['readReplicas'] > 0:
                utilization = max(
                    sum(s['readBusySeconds'] for s in states)
                    / seconds
                    / (profile['concurrency'] * profile['readReplicas']),
                    sum(s['writeBusySeconds'] for s in states) / seconds / profile['concurrency'],
                )
            else:
                utilization = sum(s['busySeconds'] for s in states) / seconds / slots(profile)
        local = [v for s in states for v in s['latenciesMs']]
        metrics = [
            metric(
                'deadline',
                'Maximum observed node response time',
                max(local) if local else None,
                'ms',
                'maximum completed node duration',
                {},
                assumptions,
            ),
            metric(
                'arrival',
                'Observed node arrivals',
                sum(s['observedArrivals'] for s in states) / seconds if seconds else None,
                'ops/s',
                'node arrivals in observation windows / observed seconds',
                {},
                assumptions,
            ),
            metric(
                'throughput',
                'Completed node throughput',
                sum(s['observedCompletions'] for s in states) / seconds if seconds else None,
                'ops/s',
                'completed node operations in observation windows / observed seconds',
                {},
                assumptions,
            ),
            metric(
                'cpu',
                'Observed CPU utilization',
                sum(s['cpuBusySeconds'] for s in states) / seconds / math.ceil(profile['cpuCores'])
                if profile.get('cpuSecondsPerOperation') and profile.get('cpuCores') and seconds
                else None,
                'ratio',
                'busy virtual CPU seconds / (observation seconds × virtual CPUs)',
                {'cores': profile.get('cpuCores', 0)},
                assumptions,
                ['Fractional cores are represented by uniformly slower virtual CPUs.'],
            ),
            metric(
                'memory',
                'Peak reserved memory utilization',
                max(s['peakMemoryBytes'] for s in states) / profile['memoryBytes']
                if profile.get('memoryBytesPerOperation') and profile.get('memoryBytes')
                else None,
                'ratio',
                'peak concurrent local jobs × bytes per operation / allocated bytes',
                {},
                assumptions,
            ),
            metric(
                'p95-latency',
                'P95 node response time',
                percentile(local, 0.95),
                'ms',
                'nearest-rank 95th percentile of completed node durations',
                {},
                assumptions,
            ),
            metric(
                'p99-latency',
                'P99 node response time',
                percentile(local, 0.99),
                'ms',
                'nearest-rank 99th percentile of completed node durations',
                {},
                assumptions,
            ),
            metric(
                'dead-lettered',
                'Dead-letter outcomes',
                sum(s['deadLettered'] for s in states),
                'messages',
                'failed consumer outcomes sent to configured dead-letter handling',
                {},
                assumptions,
            ),
            metric(
                'utilization',
                'Service-slot utilization',
                None if profile['model'] in ('queue', 'router') else utilization,
                'ratio',
                'busy slot seconds / (observation seconds × service slots)',
                {},
                assumptions,
                [],
                [profile['provenance']['source']],
            ),
            metric(
                'mean-latency',
                'Mean node response time',
                average(local),
                'ms',
                'mean node duration including synchronous downstream work',
                {},
                assumptions,
            ),
            metric(
                'queue-wait',
                'Mean local queue wait',
                average([v for s in states for v in s['waitMs']]),
                'ms',
                'mean time waiting for a service slot',
                {},
                assumptions,
            ),
            metric(
                'queue-depth',
                'Peak local queue depth',
                max(s['peakQueue'] for s in states),
                'messages',
                'maximum observed waiting queue or unacknowledged broker messages',
                {},
                assumptions,
            ),
            metric(
                'dropped',
                'Node drops',
                sum(s['dropped'] for s in states),
                'operations',
                'buffer or retention drops across replications',
                {},
                assumptions,
            ),
        ]
        for m in metrics:
            m['inputs'].update(
                concurrency=profile['concurrency'],
                replicas=profile['replicas'],
                readReplicas=profile['readReplicas'],
                observedSeconds=seconds,
            )
            mean = mean_service_ms(profile)
            if mean is not None:
                m['inputs']['meanLocalServiceMs'] = mean
            m['sources'] = [
                profile['provenance']['source'],
                profile['provenance']['recordedAt'],
                profile['provenance']['context'],
            ]
            m['assumptions'].append(f'Evidence classification: {profile["provenance"]["kind"]}.')
            if profile['provenance']['limitations']:
                m['limitations'].append(profile['provenance']['limitations'])
        report['nodes'].append(
            {
                'nodeId': node['id'],
                'bottleneck': utilization is not None
                and utilization >= profile['targetUtilization'],
                'metrics': metrics,
            }
        )
    return report
