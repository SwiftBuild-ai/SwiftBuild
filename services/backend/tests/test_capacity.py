import copy

import pytest

from swiftbuild_backend.capacity import analyze_topology, mmc
from swiftbuild_backend.simulation import simulate_topology
from test_compatibility import fixture


def equivalent(actual, expected, path='report'):
    if isinstance(expected, dict):
        assert actual.keys() == expected.keys(), (path, actual.keys() ^ expected.keys())
        for key in expected:
            if key == 'engineVersion':
                assert actual[key] == '1.2.0-python.1'
            else:
                equivalent(actual[key], expected[key], path + '.' + key)
    elif isinstance(expected, list):
        assert len(actual) == len(expected), path
        for i, (a, b) in enumerate(zip(actual, expected)):
            equivalent(a, b, path + f'[{i}]')
    elif type(expected) in (int, float):
        assert actual == pytest.approx(expected, rel=1e-10, abs=1e-10), path
    else:
        assert actual == expected, path


@pytest.mark.parametrize('case', fixture('capacity'), ids=lambda c: c['name'])
def test_analytical_and_simulation_match_offline_engine(case):
    source = copy.deepcopy(case['document'])
    equivalent(analyze_topology(source, 's'), case['analytical'])
    equivalent(simulate_topology(source, 's'), case['simulation'])
    assert source == case['document']


def test_mmc_reference_and_overload():
    q = mmc(10, 0.02, 1)
    assert q['utilization'] == pytest.approx(0.2)
    assert q['meanSeconds'] == pytest.approx(0.025)
    assert mmc(50, 0.02, 1) == {'utilization': 1}


def test_simulation_cancellation_and_budget_preserve_partial_status():
    document = fixture('capacity')[0]['document']
    cancelled = simulate_topology(document, 's', {'shouldCancel': lambda: True})
    assert cancelled['status'] == 'cancelled'
    assert cancelled['processedEvents'] == 0
