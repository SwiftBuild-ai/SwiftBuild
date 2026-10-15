import base64
import hashlib
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlsplit
from uuid import uuid4

import httpx
import pytest
from authlib.jose import JsonWebKey, jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from swiftbuild_backend.config import Settings
from swiftbuild_backend.database import one
from swiftbuild_backend.http import create_app
from swiftbuild_backend.identity import issue_invitation


@pytest.fixture
def provider():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = private.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )
    public = private.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    jwk = JsonWebKey.import_key(public, {'kid': 'swiftbuild-fixture'}).as_dict()
    state = {'codes': {}, 'verifiedChallenges': 0, 'bad': None}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def send_json(self, value, status=200):
            self.send_response(status)
            self.send_header('content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(value).encode())

        def do_GET(self):
            parsed = urlsplit(self.path)
            if parsed.path == '/discovery':
                return self.send_json(
                    {
                        'issuer': state['issuer'],
                        'authorization_endpoint': state['issuer'] + '/authorize',
                        'token_endpoint': state['issuer'] + '/token',
                        'jwks_uri': state['issuer'] + '/jwks',
                        'response_types_supported': ['code'],
                        'subject_types_supported': ['public'],
                        'id_token_signing_alg_values_supported': ['RS256'],
                        'code_challenge_methods_supported': ['S256'],
                        'token_endpoint_auth_methods_supported': [
                            'client_secret_basic',
                            'client_secret_post',
                        ],
                    }
                )
            if parsed.path == '/jwks':
                return self.send_json({'keys': [jwk]})
            if parsed.path == '/authorize':
                query = parse_qs(parsed.query)
                code = uuid4().hex
                state['codes'][code] = query
                self.send_response(302)
                self.send_header(
                    'location',
                    query['redirect_uri'][0]
                    + '?'
                    + urlencode({'code': code, 'state': query['state'][0]}),
                )
                self.end_headers()
                return
            self.send_json({}, 404)

        def do_POST(self):
            params = parse_qs(self.rfile.read(int(self.headers['content-length'])).decode())
            query = state['codes'].pop(params.get('code', [''])[0], None)
            challenge = (
                base64.urlsafe_b64encode(
                    hashlib.sha256(params.get('code_verifier', [''])[0].encode()).digest()
                )
                .rstrip(b'=')
                .decode()
            )
            if (
                not query
                or query.get('code_challenge', [''])[0] != challenge
                or query.get('code_challenge_method') != ['S256']
            ):
                return self.send_json({'error': 'invalid_grant'}, 400)
            state['verifiedChallenges'] += 1
            now = int(time.time())
            claims = {
                'sub': 'synthetic-organization-user',
                'email': 'owner@example.test',
                'name': 'Engineer',
                'email_verified': True,
                'iss': state['issuer'],
                'aud': 'swiftbuild-fixture',
                'nonce': query['nonce'][0],
                'iat': now,
                'exp': now + 120,
            }
            bad = state['bad']
            if bad == 'exp':
                claims['exp'] = now - 3600
            elif bad and bad != 'signature':
                claims[bad] = False if bad == 'email_verified' else 'incorrect-value'
            signing_key = pem
            if bad == 'signature':
                signing_key = rsa.generate_private_key(
                    public_exponent=65537, key_size=2048
                ).private_bytes(
                    serialization.Encoding.PEM,
                    serialization.PrivateFormat.PKCS8,
                    serialization.NoEncryption(),
                )
            token = jwt.encode(
                {'alg': 'RS256', 'kid': 'swiftbuild-fixture'}, claims, signing_key
            ).decode()
            self.send_json(
                {
                    'access_token': 'synthetic-provider-token',
                    'token_type': 'Bearer',
                    'expires_in': 120,
                    'id_token': token,
                }
            )

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    state['issuer'] = 'http://127.0.0.1:' + str(server.server_address[1])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield state
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


async def sign_in(client, path='sign-in/social'):
    start = await client.post(
        '/api/auth/' + path, json={'provider': 'organization', 'callbackURL': '/account'}
    )
    assert start.status_code == 200, start.text
    async with httpx.AsyncClient() as external:
        redirect = await external.get(start.json()['url'])
    assert redirect.status_code == 302
    return await client.get(redirect.headers['location'])


@pytest.mark.parametrize('bad', [None, 'aud', 'iss', 'nonce', 'email_verified', 'signature', 'exp'])
async def test_oidc_signed_claims_pkce_and_admission(pool, provider, bad):
    provider['bad'] = bad
    settings = Settings(
        '',
        'http://localhost:3000',
        'synthetic-test-secret-' * 3,
        True,
        oidc_discovery_url=provider['issuer'] + '/discovery',
        oidc_client_id='swiftbuild-fixture',
        oidc_client_secret='synthetic-client-secret',
    )
    app = create_app(settings, pool=pool)
    await issue_invitation(pool, 'owner@example.test', bootstrap=True)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app),
        base_url=settings.origin,
        headers={'origin': settings.origin},
    ) as client:
        response = await sign_in(client)
        assert response.status_code == (302 if bad is None else 403), response.text
        assert provider['verifiedChallenges'] == 1
        session = await client.get('/api/auth/get-session')
        assert session.headers['x-swiftbuild-oidc'] == '1'
        assert (session.json() is not None) == (bad is None)
    async with pool.connection() as c:
        count = (await one(c, 'SELECT count(*) AS n FROM sb_admitted_users'))['n']
    assert count == (1 if bad is None else 0)


async def test_oidc_existing_email_requires_explicit_authenticated_linking(pool, provider):
    settings = Settings(
        '',
        'http://localhost:3000',
        'synthetic-test-secret-' * 3,
        True,
        oidc_discovery_url=provider['issuer'] + '/discovery',
        oidc_client_id='swiftbuild-fixture',
        oidc_client_secret='synthetic-client-secret',
    )
    app = create_app(settings, pool=pool)
    invitation = await issue_invitation(pool, 'owner@example.test', bootstrap=True)
    await app.state.identity.create_account(
        'owner@example.test', 'synthetic password for tests', 'Owner', invitation['token']
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app),
        base_url=settings.origin,
        headers={'origin': settings.origin},
    ) as client:
        assert (await sign_in(client)).status_code == 403
        response = await client.post(
            '/api/auth/sign-in/email',
            json={'email': 'owner@example.test', 'password': 'synthetic password for tests'},
        )
        assert response.status_code == 200
        assert (await sign_in(client, 'link-social')).status_code == 302
        accounts = (await client.get('/api/auth/list-accounts')).json()
        assert {a['providerId'] for a in accounts} == {'credential', 'organization'}
        assert all('accessToken' not in a and 'password' not in a for a in accounts)


async def test_oidc_rejects_tampered_state_and_callback_replay(pool, provider):
    settings = Settings(
        '',
        'http://localhost:3000',
        'synthetic-test-secret-' * 3,
        True,
        oidc_discovery_url=provider['issuer'] + '/discovery',
        oidc_client_id='swiftbuild-fixture',
        oidc_client_secret='synthetic-client-secret',
    )
    app = create_app(settings, pool=pool)
    await issue_invitation(pool, 'owner@example.test', bootstrap=True)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app),
        base_url=settings.origin,
        headers={'origin': settings.origin},
    ) as client:
        started = await client.post('/api/auth/sign-in/social', json={'provider': 'organization'})
        async with httpx.AsyncClient() as external:
            authorization = await external.get(started.json()['url'])
        callback = authorization.headers['location']
        parsed = urlsplit(callback)
        query = parse_qs(parsed.query)
        forged = parsed._replace(
            query=urlencode(
                {
                    'code': query['code'][0],
                    'state': 'tampered-state',
                }
            )
        ).geturl()
        assert (await client.get(forged)).status_code == 403
        assert provider['verifiedChallenges'] == 0
        assert (await client.get(callback)).status_code == 302
        assert (await client.get(callback)).status_code == 403
        assert provider['verifiedChallenges'] == 1
