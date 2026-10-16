"""Native validation parity: structural defaults plus graph/configuration invariants."""

import copy
import json
import math
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker, ValidationError

from .serialization import js_json, js_trim

SCHEMAS = json.loads((Path(__file__).parent / 'contracts/schemas.json').read_text('utf-8'))
MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
MAX_COMPUTATION_BYTES = 8 * 1024 * 1024


Validator = Draft202012Validator


def _validator(schema):
    return Validator(schema, format_checker=FormatChecker())


def normalize(value, schema, root=None):
    """Apply Zod input defaults and object stripping without coercing scalar values."""
    root = schema if root is None else root
    if '$ref' in schema:
        target = root
        if not schema['$ref'].startswith('#/'):
            raise ValueError('Only local contract references are allowed.')
        for segment in schema['$ref'][2:].split('/'):
            target = target[segment.replace('~1', '/').replace('~0', '~')]
        return normalize(value, target, root)
    if 'anyOf' in schema or 'oneOf' in schema:
        for choice in schema.get('anyOf', schema.get('oneOf', [])):
            try:
                normalized = normalize(value, choice, root)
                _validator(root).evolve(schema=choice).validate(normalized)
                return normalized
            except (ValueError, ValidationError):
                continue
        raise ValueError('No matching union member.')
    if isinstance(value, dict) and schema.get('type') == 'object':
        properties = schema.get('properties', {})
        additional = schema.get('additionalProperties')
        if additional is False and any(k not in properties for k in value):
            raise ValueError('Unknown field.')
        result = {}
        for key, child in properties.items():
            if key in value:
                result[key] = normalize(value[key], child, root)
            elif 'default' in child:
                result[key] = normalize(copy.deepcopy(child['default']), child, root)
        if isinstance(additional, dict) or additional is True:
            for key in value.keys() - properties.keys():
                result[key] = normalize(
                    value[key], additional if isinstance(additional, dict) else {}, root
                )
        return result
    if isinstance(value, list):
        prefix = schema.get('prefixItems', [])
        return [
            normalize(v, prefix[i] if i < len(prefix) else schema.get('items', {}), root)
            for i, v in enumerate(value)
        ]
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError('Non-finite JSON number.')
    return copy.deepcopy(value)


def validate_contract(name, value):
    schema = SCHEMAS[name]
    # JSON Schema allows $defs. Normalize works with fully expanded build-time schemas.
    value = normalize(value, schema)
    _validator(schema).validate(value)
    return value


def configuration_errors(definition, configuration):
    errors = []
    for field in definition['configurationSchema']:
        label, key = field['label'], field['key']
        if key not in configuration:
            if field['required']:
                errors.append(f'{label} is required.')
            continue
        value, kind = configuration[key], field['type']
        if kind == 'number':
            if type(value) not in (int, float) or not math.isfinite(value):
                errors.append(f'{label} must be a number.')
            else:
                if field.get('integer') and value % 1:
                    errors.append(f'{label} must be a whole number.')
                if 'min' in field and value < field['min']:
                    errors.append(f'{label} must be at least {field["min"]}.')
                if 'max' in field and value > field['max']:
                    errors.append(f'{label} must be at most {field["max"]}.')
        if kind == 'boolean' and type(value) is not bool:
            errors.append(f'{label} must be true or false.')
        if kind == 'string' and (
            not isinstance(value, str) or (field['required'] and not js_trim(value))
        ):
            errors.append(f'{label} must be text.')
        if kind == 'select' and value not in field.get('options', []):
            errors.append(f'{label} must be one of {", ".join(field.get("options", []))}.')
    for rule in definition.get('validationRules', []):
        value, limit = configuration.get(rule['field']), configuration.get(rule['limitField'])
        if type(value) in (int, float) and type(limit) in (int, float) and value > limit:
            errors.append(rule['message'])
    return errors


def graph_issues(d):
    issues = []

    def add(path, message):
        issues.append({'path': path, 'message': message})

    collections = (
        'nodes',
        'edges',
        'components',
        'views',
        'requirements',
        'nonFunctionalRequirements',
        'decisions',
        'estimates',
        'environments',
        'deployments',
        'annotations',
        'findings',
        'versions',
        'scenarios',
        'performanceProfiles',
        'flowPolicies',
        'assessments',
    )
    for key in collections:
        seen = set()
        for item in d[key]:
            if item['id'] in seen:
                add(key, f'Duplicate ID {item["id"]}.')
            seen.add(item['id'])
    nodes = {n['id']: n for n in d['nodes']}
    components = {c['id']: c for c in d['components']}
    edges = {e['id'] for e in d['edges']}
    requirements = {r['id'] for r in d['requirements'] + d['nonFunctionalRequirements']}
    versions = {v['id'] for v in d['versions']}
    environments = {e['id'] for e in d['environments']}
    if len(requirements) != len(d['requirements']) + len(d['nonFunctionalRequirements']):
        add(
            'requirements',
            'Requirement IDs must be unique across functional and nonfunctional requirements.',
        )
    for node in d['nodes']:
        definition = components.get(node['componentId'])
        if not definition:
            add(node['id'], f'Unknown component {node["componentId"]}.')
            continue
        if node['componentVersion'] != definition['version']:
            add(node['id'], 'Component version does not match embedded definition.')
        for error in configuration_errors(definition, node['configuration']):
            add(node['id'], error)
        if node.get('parentId'):
            parent = nodes.get(node['parentId'])
            if (
                not parent
                or components.get(parent['componentId'], {}).get('category') != 'boundary'
            ):
                add(node['id'], 'Parent must reference a boundary.')
            visited, cursor = {node['id']}, node['parentId']
            while cursor:
                if cursor in visited:
                    add(node['id'], 'Boundary containment cycle.')
                    break
                visited.add(cursor)
                cursor = nodes.get(cursor, {}).get('parentId')
    for component in d['components']:
        seen = set()
        for port in component['ports']:
            if port['id'] in seen:
                add(component['id'], f'Duplicate port {port["id"]}.')
            seen.add(port['id'])
        keys = set()
        for field in component['configurationSchema']:
            if field['key'] in keys:
                add(component['id'], f'Duplicate configuration field {field["key"]}.')
            keys.add(field['key'])
        for binding in component.get('catalog', {}).get('resourceBindings', {}).values():
            if binding['field'] not in keys:
                add(component['id'], f'Unknown resource binding field {binding["field"]}.')
        for rule in component.get('validationRules', []):
            if rule['field'] not in keys or rule['limitField'] not in keys:
                add(component['id'], 'Configuration rule references an unknown field.')
        for error in configuration_errors(
            component, {f['key']: f['default'] for f in component['configurationSchema']}
        ):
            add(component['id'], 'Invalid default: ' + error)
    for edge in d['edges']:
        source, target = nodes.get(edge['source']['nodeId']), nodes.get(edge['target']['nodeId'])
        output = (
            next(
                (
                    p
                    for p in components.get(source['componentId'], {}).get('ports', [])
                    if p['id'] == edge['source']['portId']
                ),
                None,
            )
            if source
            else None
        )
        input_ = (
            next(
                (
                    p
                    for p in components.get(target['componentId'], {}).get('ports', [])
                    if p['id'] == edge['target']['portId']
                ),
                None,
            )
            if target
            else None
        )
        if (
            not source
            or not target
            or source['id'] == target['id']
            or not output
            or not input_
            or output['direction'] != 'output'
            or input_['direction'] != 'input'
            or edge['relationship'] not in output['relationships']
            or edge['relationship'] not in input_['relationships']
        ):
            add(edge['id'], 'Connection references missing or incompatible nodes/ports.')
    for view in d['views']:
        listed = set()
        for identifier in view['nodeIds']:
            if identifier in listed:
                add(view['id'], f'Duplicate view node {identifier}.')
            listed.add(identifier)
            if identifier not in nodes:
                add(view['id'], f'Missing node {identifier}.')
            if identifier not in view['layout']:
                add(view['id'], f'Missing layout for {identifier}.')
        for identifier in view['layout']:
            if identifier not in listed:
                add(view['id'], f'Layout references unlisted node {identifier}.')
    for item in (
        d['requirements']
        + d['nonFunctionalRequirements']
        + d['decisions']
        + d['annotations']
        + d['findings']
    ):
        for identifier in item['nodeIds']:
            if identifier not in nodes:
                add(item['id'], f'Missing node {identifier}.')
    for item in d['decisions'] + d['findings']:
        for identifier in item['edgeIds']:
            if identifier not in edges:
                add(item['id'], f'Missing edge {identifier}.')
    for item in d['decisions']:
        for field, available, label in [
            ('requirementIds', requirements, 'requirement'),
            ('versionIds', versions, 'version'),
        ]:
            for identifier in item[field]:
                if identifier not in available:
                    add(item['id'], f'Missing {label} {identifier}.')
    for deployment in d['deployments']:
        if deployment['nodeId'] not in nodes:
            add(deployment['id'], 'Missing deployment node.')
        if deployment['environmentId'] not in environments:
            add(deployment['id'], 'Missing deployment environment.')
    scenarios, traffic, targets = {s['id'] for s in d['scenarios']}, set(), set()
    for scenario in d['scenarios']:
        for t in scenario['trafficClasses']:
            if t['id'] in traffic:
                add(scenario['id'], f'Duplicate traffic class {t["id"]}.')
            traffic.add(t['id'])
            if t['entryNodeId'] not in nodes:
                add(t['id'], 'Missing traffic entry node.')
            elif (
                components.get(nodes[t['entryNodeId']]['componentId'], {}).get('category')
                == 'boundary'
            ):
                add(t['id'], 'A boundary cannot be a workload entry point.')
            bursts = sorted(t['bursts'], key=lambda b: b['startSeconds'])
            for previous, current in zip(bursts, bursts[1:]):
                if current['startSeconds'] < previous['startSeconds'] + previous['durationSeconds']:
                    add(t['id'], 'Burst intervals must not overlap.')
        for target in scenario['targets']:
            if target['id'] in targets:
                add(target['id'], 'Duplicate target ID.')
            targets.add(target['id'])
            if target.get('nodeId') and target['nodeId'] not in nodes:
                add(target['id'], 'Missing target node.')
            if target.get('trafficClassId') and target['trafficClassId'] not in {
                t['id'] for t in scenario['trafficClasses']
            }:
                add(target['id'], 'Target traffic class must belong to its scenario.')
    profile_nodes = set()
    for profile in d['performanceProfiles']:
        node = nodes.get(profile['nodeId'])
        if not node:
            add(profile['id'], 'Missing performance profile node.')
        elif components.get(node['componentId'], {}).get('category') == 'boundary':
            add(
                profile['id'],
                'Boundaries do not consume processing capacity; attach the profile to a concrete component.',
            )
        if profile['nodeId'] in profile_nodes:
            add(profile['id'], 'Only one performance profile per node is supported.')
        profile_nodes.add(profile['nodeId'])
    policy_keys = set()
    for policy in d['flowPolicies']:
        if policy['edgeId'] not in edges:
            add(policy['id'], 'Missing flow policy edge.')
        if policy.get('trafficClassId') and policy['trafficClassId'] not in traffic:
            add(policy['id'], 'Missing flow policy traffic class.')
        if policy.get('cacheNodeId') and not any(
            p['nodeId'] == policy['cacheNodeId'] and p['model'] == 'cache'
            for p in d['performanceProfiles']
        ):
            add(policy['id'], 'Cache routing requires a cache performance profile.')
        key = (policy['edgeId'], policy.get('trafficClassId'))
        if key in policy_keys:
            add(policy['id'], 'Duplicate edge policy for this traffic class.')
        policy_keys.add(key)
    for assessment in d['assessments']:
        for field, available, label in [
            ('requirementId', requirements, 'requirement'),
            ('scenarioId', scenarios, 'scenario'),
            ('targetId', targets, 'target'),
        ]:
            if assessment.get(field) and assessment[field] not in available:
                add(assessment['id'], f'Missing assessment {label}.')
    return issues


def validate_document(value):
    if not isinstance(value, dict):
        raise ValueError('Document must be an object.')
    value = copy.deepcopy(value)
    if value.get('schemaVersion') == '1.0':
        value['schemaVersion'] = '1.1'
    document = validate_contract('ArchitectureDocument', value)
    issues = graph_issues(document)
    if issues:
        raise ValueError('\n'.join(f'{i["path"]}: {i["message"]}' for i in issues))
    return document


def validate_archive(value):
    value = copy.deepcopy(value)
    value['document'] = validate_document(value['document'])
    for checkpoint in value['checkpoints']:
        checkpoint['document'] = validate_document(checkpoint['document'])
    archive = validate_contract('ProjectArchive', value)
    if len({c['id'] for c in archive['checkpoints']}) != len(archive['checkpoints']):
        raise ValueError('Duplicate checkpoint.')
    if len(js_json(archive, indent=2).encode()) > MAX_ARCHIVE_BYTES:
        raise ValueError('Project archive exceeds 50 MB.')
    return archive
