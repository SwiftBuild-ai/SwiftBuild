import copy
import hashlib
import json
import importlib
from pathlib import Path

import pytest
from jsonschema import ValidationError

from swiftbuild_backend.domain import validate_archive, validate_document
from swiftbuild_backend.random import random_for
from swiftbuild_backend.serialization import computation_digest, js_json, project_digest

FIXTURES = Path(__file__).parent / 'fixtures'


def fixture(name):
    return json.loads((FIXTURES / (name + '.json')).read_text('utf-8'))


def test_legacy_email_acceptance():
    from swiftbuild_backend.identity import email

    for case in fixture('emails'):
        if case['valid']:
            assert email(case['value']) == case['value'].lower()
        else:
            with pytest.raises(ValueError):
                email(case['value'])


@pytest.mark.parametrize('case', fixture('documents'), ids=lambda c: c['name'])
def test_document_compatibility(case):
    original = copy.deepcopy(case['input'])
    if case['valid']:
        assert validate_document(case['input']) == case['output']
    else:
        with pytest.raises((ValueError, ValidationError)):
            validate_document(case['input'])
    assert case['input'] == original


def test_archive_digest_and_timestamp_only_save():
    case = fixture('archive')
    archive = validate_archive(case['archive'])
    assert project_digest(archive) == case['digest']
    archive['exportedAt'] = '2026-10-16T00:00:00Z'
    assert project_digest(archive) == case['digest']


@pytest.mark.parametrize('case', fixture('serialization'))
def test_javascript_serialization(case):
    assert js_json(case['value'], sort_keys=True) == case['json']


@pytest.mark.parametrize('case', fixture('random'))
def test_random_streams(case):
    random = random_for(case['seed'], case['stream'])
    assert [random() for _ in case['values']] == case['values']


def test_computation_digest():
    assert (
        computation_digest({'n': 1.0, 'text': 'café'})
        == hashlib.sha256(fixture('provenance')['computationCanonical'].encode()).hexdigest()
    )


def test_generated_models_import_and_validate_normalized_documents():
    from swiftbuild_backend.domain import SCHEMAS

    for name in SCHEMAS:
        module = importlib.import_module('swiftbuild_backend.generated.' + name)
        assert getattr(module, name)
    normalized = validate_document(fixture('documents')[0]['input'])
    model = importlib.import_module(
        'swiftbuild_backend.generated.ArchitectureDocument'
    ).ArchitectureDocument
    model.model_validate_json(js_json(normalized), strict=True)


@pytest.mark.parametrize('case', fixture('passwords'))
def test_existing_password_hashes_and_normalization(case):
    from swiftbuild_backend.identity import verify_password
    import unicodedata

    assert verify_password(case['hash'], case['password'])
    assert verify_password(case['hash'], unicodedata.normalize('NFKC', case['password']))
    assert not verify_password(case['hash'], 'a different synthetic password')


def test_existing_provider_token_ciphertext_and_new_ciphertext():
    from nacl.bindings import crypto_aead_xchacha20poly1305_ietf_decrypt
    from swiftbuild_backend.oidc import encrypt_token

    case = fixture('encryption')

    def decrypt(value):
        raw = bytes.fromhex(value)
        return crypto_aead_xchacha20poly1305_ietf_decrypt(
            raw[24:], b'', raw[:24], hashlib.sha256(case['secret'].encode()).digest()
        ).decode()

    assert decrypt(case['ciphertext']) == case['token']
    assert decrypt(encrypt_token(case['secret'], case['token'])) == case['token']
