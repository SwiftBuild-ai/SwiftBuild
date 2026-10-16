"""OIDC protocol delegated to Authlib; admission and linking remain application policy."""

import hashlib
import secrets
from uuid import uuid4

from authlib.integrations.starlette_client import OAuth
from nacl.bindings import crypto_aead_xchacha20poly1305_ietf_encrypt
from starlette.middleware.sessions import SessionMiddleware
from starlette.responses import RedirectResponse

from .database import one, transaction
from .errors import ServiceError
from .identity import COOKIE, active, admit, email, invitation
from .projects import name


def encrypt_token(secret, value):
    """Match the installed identity library's nonce-prefixed XChaCha20 ciphertext."""
    if value is None:
        return None
    nonce = secrets.token_bytes(24)
    ciphertext = crypto_aead_xchacha20poly1305_ietf_encrypt(
        value.encode(), b'', nonce, hashlib.sha256(secret.encode()).digest()
    )
    return (nonce + ciphertext).hex()


def configure_oidc(app, settings, identity, set_cookie):
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.secret,
        session_cookie='swiftbuild.oidc',
        max_age=600,
        same_site='lax',
        https_only=settings.secure,
    )
    oauth = OAuth()
    oauth.register(
        name='organization',
        server_metadata_url=settings.oidc_discovery_url,
        client_id=settings.oidc_client_id,
        client_secret=settings.oidc_client_secret,
        client_kwargs={'scope': 'openid email profile', 'code_challenge_method': 'S256'},
    )
    app.state.oauth = oauth

    async def callback(request):
        try:
            token = await oauth.organization.authorize_access_token(request)
            info = token.get('userinfo')
            if not info or info.get('email_verified') is not True or not info.get('sub'):
                raise ServiceError(403, 'A verified invited identity is required.')
            address = email(info.get('email'))
            link_id = request.session.pop('swiftbuild_link_user', None)
            callback_url = request.session.pop('swiftbuild_callback', settings.origin + '/account')
            signed_in = await identity.session(request.cookies.get(COOKIE)) if link_id else None
            if link_id and (
                not signed_in
                or signed_in['user']['id'] != link_id
                or signed_in['user']['email'] != address
            ):
                raise ServiceError(
                    403, 'Account linking requires the original authenticated account.'
                )
            async with transaction(identity.pool) as c:
                await c.execute('SELECT pg_advisory_xact_lock(1398233415)')
                account = await one(
                    c,
                    'SELECT * FROM sb_auth_accounts WHERE "providerId"=\'organization\' AND "accountId"=%s FOR UPDATE',
                    (info['sub'],),
                )
                existing = await one(
                    c, 'SELECT * FROM sb_auth_users WHERE email=%s FOR UPDATE', (address,)
                )
                if account:
                    user_id = account['userId']
                    if link_id and user_id != link_id:
                        raise ServiceError(403, 'Identity already belongs to another account.')
                    if (
                        not existing
                        or existing['id'] != user_id
                        or not await active(c, user_id, True)
                    ):
                        raise ServiceError(403, 'Account is unavailable.')
                else:
                    if existing and not link_id:
                        raise ServiceError(
                            403, 'Sign in before explicitly linking this organizational identity.'
                        )
                    if link_id:
                        user_id = link_id
                        if not await active(c, user_id, True):
                            raise ServiceError(403, 'Account is unavailable.')
                    else:
                        if not await invitation(c, address, lock=True):
                            raise ServiceError(403, 'A verified invited identity is required.')
                        user_id = str(uuid4())
                        await c.execute(
                            'INSERT INTO sb_auth_users(id,name,email,"emailVerified","createdAt","updatedAt") VALUES (%s,%s,%s,true,now(),now())',
                            (user_id, name(info.get('name') or address), address),
                        )
                        await admit(c, user_id, address)
                    await c.execute(
                        'INSERT INTO sb_auth_accounts(id,"providerId","accountId","userId","accessToken","refreshToken","idToken",scope,"createdAt","updatedAt") VALUES (%s,\'organization\',%s,%s,%s,%s,%s,%s,now(),now())',
                        (
                            str(uuid4()),
                            info['sub'],
                            user_id,
                            encrypt_token(settings.secret, token.get('access_token')),
                            encrypt_token(settings.secret, token.get('refresh_token')),
                            encrypt_token(settings.secret, token.get('id_token')),
                            token.get('scope'),
                        ),
                    )
                session_token = await identity.new_session(c, user_id)
            return set_cookie(RedirectResponse(callback_url, status_code=302), session_token)
        except ServiceError:
            raise
        except Exception:
            # Provider errors can contain codes, tokens, and private claim values.
            raise ServiceError(
                403, 'Organizational sign-in was rejected.', 'OIDC_REJECTED'
            ) from None

    app.state.oauth_callback = callback
