import asyncio
import copy
import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, ValidationError

import app as supervisor
from engine import reliability, compute, canonical_digest

PROVENANCE = {'kind': 'assumed', 'source': 'Reference', 'recordedAt': '2026-10-13T00:00:00Z', 'context': 'Numerical test', 'limitations': ''}


def component(identifier, up=80, repair=20):
    return {'nodeId': identifier, 'meanUpSeconds': up, 'meanRepairSeconds': repair, 'provenance': PROVENANCE}


def model(kind='and', count=2):
    return {'components': [component(f'n{i}') for i in range(count)], 'groups': [], 'gates': [{'id': 'success', 'kind': kind, 'inputs': [f'n{i}' for i in range(count)], **({'k': 2} if kind == 'k-of-n' else {})}], 'root': 'success'}


def request(definition=None, deadline=120000):
    data = {'contractVersion': '1.0', 'projectId': '00000000-0000-4000-8000-000000000001', 'revision': 1, 'definition': definition or {'kind': 'reliability', 'reliability': model(), 'ranges': []}, 'seed': 42, 'samples': 1000, 'deadlineMs': deadline}
    return {'attemptId': '00000000-0000-4000-8000-000000000002', 'input': data, 'digest': canonical_digest(data)}


@pytest.mark.parametrize('kind,count,expected', [('and', 1, .8), ('and', 2, .64), ('or', 2, .96), ('k-of-n', 3, .896)])
def test_independent_references(kind, count, expected):
    assert reliability(model(kind, count), 42, 1000)[0] == pytest.approx(expected, abs=1e-12)


def test_shared_failure_and_repeated_reference():
    r = model('or')
    r['groups'] = [{'id': 'zone', 'nodeIds': ['n0', 'n1'], 'meanUpSeconds': 90, 'meanRepairSeconds': 10, 'provenance': PROVENANCE}]
    assert reliability(r, 42, 1000)[0] == pytest.approx(.864)
    r['gates'] = [{'id': 'left', 'kind': 'or', 'inputs': ['n0', 'n1']}, {'id': 'success', 'kind': 'and', 'inputs': ['n0', 'left']}]
    assert reliability(r, 42, 1000)[0] == pytest.approx(.72)
    assert reliability(r, 42, 1000, 'zone')[0] == 0


def test_monte_carlo_replays_with_boundary_sampling_interval():
    r = model('or', 17)
    a = reliability(r, 17, 1000)
    assert a == reliability(r, 17, 1000)
    assert a[2] == 'monte-carlo'
    assert a[1][0] < a[1][1] <= 1


def test_forced_outage_and_finite_differences():
    definition = {'kind': 'reliability', 'reliability': model('or'), 'ranges': [{'targetId': 'n0', 'parameter': 'meanRepairSeconds', 'values': [10, 20, 40]}]}
    r = compute(request(definition))
    assert r['impacts'][0]['availability'] == pytest.approx(.8)
    assert r['impacts'][0]['loss'] == pytest.approx(.16)
    assert all(row['slope'] < 0 for row in r['sensitivity'])
    assert compute(request(definition)) == r


def test_cross_language_fixtures():
    fixture = json.loads((Path(__file__).parents[1] / 'fixtures.json').read_text(encoding='utf-8'))
    for case in fixture['canonical']:
        assert canonical_digest(case['input']) == case['digest']
    validator = Draft202012Validator(supervisor.SCHEMAS['ExecutionRequest'])
    for case in fixture['accepted']:
        validator.validate(case)
        assert canonical_digest(case['input']) == case['digest']
    for case in fixture['rejected']:
        with pytest.raises(ValidationError):
            validator.validate(case)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(supervisor, 'TOKEN', 't' * 64)
    with TestClient(supervisor.app) as client:
        yield client


HEADERS = {'authorization': 'Bearer ' + 't' * 64}


def test_supervisor_authentication_bounds_and_real_child(client):
    assert client.get('/health').status_code == 200
    assert client.get('/v1/ready').status_code == 401
    assert client.get('/v1/ready', headers=HEADERS).json()['contractVersion'] == '1.0'
    response = client.post('/v1/executions', json=request(), headers=HEADERS)
    assert response.status_code == 200, response.text
    assert response.json()['availability'] == pytest.approx(.64)
    bad = request(); bad['input']['contractVersion'] = '2.0'
    assert client.post('/v1/executions', json=bad, headers=HEADERS).status_code == 400
    bad = request(); bad['digest'] = '0' * 64
    assert client.post('/v1/executions', json=bad, headers=HEADERS).status_code == 400
    assert client.post('/v1/executions', content=b'x' * (supervisor.LIMIT + 1), headers=HEADERS).status_code == 413


def test_cancellation_preserves_health_responsiveness(monkeypatch):
    monkeypatch.setattr(supervisor, 'TOKEN', 't' * 64)
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=supervisor.app), base_url='http://test') as client:
            payload = request({'kind': 'reliability', 'reliability': model('and', 100), 'ranges': []})
            payload['input']['samples'] = 100000
            payload['digest'] = canonical_digest(payload['input'])
            running = asyncio.create_task(client.post('/v1/executions', json=payload, headers=HEADERS))
            for _ in range(100):
                if supervisor.active:
                    break
                await asyncio.sleep(.01)
            assert supervisor.active
            assert (await client.get('/health')).status_code == 200
            assert (await client.delete('/v1/executions/' + payload['attemptId'], headers=HEADERS)).status_code == 200
            result = await running
            assert result.status_code == 409
            assert not supervisor.active
    asyncio.run(run())


def test_deadline_terminates_child(client):
    result = client.post('/v1/executions', json=request({'kind': 'reliability', 'reliability': model('and', 100), 'ranges': []}, deadline=100), headers=HEADERS)
    assert result.status_code == 504, result.text
    assert not supervisor.active


def test_memory_failure_is_classified(client, monkeypatch):
    class Exhausted:
        returncode = 75
        async def wait(self):
            return 75
    async def spawn(*args, **kwargs):
        return Exhausted()
    monkeypatch.setattr(supervisor.asyncio, 'create_subprocess_exec', spawn)
    result = client.post('/v1/executions', json=request(), headers=HEADERS)
    assert result.status_code == 422
    assert result.json()['detail'] == 'MEMORY_EXHAUSTED'
    assert not supervisor.active


def test_malformed_child_response_is_redacted(client, monkeypatch, caplog):
    class Successful:
        returncode = 0
        async def wait(self):
            return 0
    async def spawn(*args, **kwargs):
        Path(args[3]).write_text('{"private":"private-fixture-marker"}', encoding='utf-8')
        return Successful()
    monkeypatch.setattr(supervisor.asyncio, 'create_subprocess_exec', spawn)
    result = client.post('/v1/executions', json=request(), headers=HEADERS)
    assert result.status_code == 422
    assert result.json()['detail'] == 'OUTPUT_SCHEMA_INVALID'
    assert 'private-fixture-marker' not in caplog.text
    assert not supervisor.active


def test_json_integer_float_forms_share_the_same_execution(client):
    payload = request({'kind': 'reliability', 'reliability': model('or', 17), 'ranges': []})
    payload['input']['seed'] = 42.0
    payload['input']['samples'] = 1000.0
    result = client.post('/v1/executions', json=payload, headers=HEADERS)
    assert result.status_code == 200, result.text
    assert result.json()['method'] == 'monte-carlo'
