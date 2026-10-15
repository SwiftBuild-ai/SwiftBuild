"""Invite-only identity on the existing database schema; no public issuance API."""

import asyncio
import base64
import hashlib
import hmac
import re
import secrets
import time
import unicodedata
from datetime import datetime, timezone
from uuid import uuid4

from .database import all_rows, one, transaction
from .errors import ServiceError
from .projects import identifier, name

COOKIE = 'swiftbuild.session'
BOOTSTRAP_LOCK = 1398233415


def public_user(row):
    result = {k: row[k] for k in ('id', 'name', 'email', 'emailVerified', 'image')}
    for key in ('createdAt', 'updatedAt'):
        result[key] = row[key].isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    return result


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def verification_key(token):
    return (
        base64.urlsafe_b64encode(hashlib.sha256(('reset-password:' + token).encode()).digest())
        .rstrip(b'=')
        .decode()
    )


def email(value):
    if not isinstance(value, str) or not re.fullmatch(
        r"(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}",
        value,
    ):
        raise ValueError('Invalid email.')
    return value.lower()


def password_key(password, salt):
    if not isinstance(password, str) or len(password.encode('utf-16-le')) // 2 > 128:
        raise ValueError('Invalid password length.')
    return hashlib.scrypt(
        unicodedata.normalize('NFKC', password).encode(),
        salt=salt.encode(),
        n=16384,
        r=16,
        p=1,
        dklen=64,
        maxmem=67108864,
    )


def hash_password(password):
    if not isinstance(password, str) or not 12 <= len(password.encode('utf-16-le')) // 2 <= 128:
        raise ValueError('Password must contain 12 to 128 characters.')
    salt = secrets.token_hex(16)
    return salt + ':' + password_key(password, salt).hex()


def verify_password(encoded, password):
    try:
        salt, expected = encoded.split(':')
        if not re.fullmatch('[0-9a-f]{32}', salt) or not re.fullmatch('[0-9a-f]{128}', expected):
            return False
        return hmac.compare_digest(password_key(password, salt), bytes.fromhex(expected))
    except (ValueError, TypeError, AttributeError, UnicodeError):
        return False


async def active(c, user_id, lock=False):
    return bool(
        await one(
            c,
            'SELECT user_id FROM sb_admitted_users WHERE user_id=%s AND active'
            + (' FOR SHARE' if lock else ''),
            (user_id,),
        )
    )


async def invitation(c, address, token=None, lock=False):
    if token is not None and (
        not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', token)
    ):
        return None
    digest = token_hash(token) if token is not None else None
    return await one(
        c,
        'SELECT id,email,workspace_id,role,bootstrap FROM sb_invitations WHERE email=%s AND (%s::text IS NULL OR token_hash=%s) AND used_by IS NULL AND NOT revoked AND expires_at>now() ORDER BY expires_at,id LIMIT 1'
        + (' FOR UPDATE' if lock else ''),
        (email(address), digest, digest),
    )


async def issue_invitation(
    pool, address, *, bootstrap=False, rotate=False, workspace_id=None, role='editor'
):
    address = email(address)
    if (
        role not in ('owner', 'editor', 'viewer')
        or (bootstrap and workspace_id)
        or (not bootstrap and not workspace_id)
        or (rotate and not bootstrap)
    ):
        raise ValueError('Invalid invitation options.')
    if workspace_id:
        identifier(workspace_id)
    token, invite_id = secrets.token_urlsafe(32), str(uuid4())
    async with transaction(pool) as c:
        if bootstrap:
            await c.execute('SELECT pg_advisory_xact_lock(%s)', (BOOTSTRAP_LOCK,))
            issued = await one(c, 'SELECT id FROM sb_instance')
            if rotate:
                if not issued:
                    raise ValueError('Issue the initial bootstrap invitation before rotating it.')
                if await one(
                    c,
                    'SELECT 1 FROM sb_invitations WHERE bootstrap AND used_by IS NOT NULL UNION ALL SELECT 1 FROM sb_admitted_users WHERE administrator LIMIT 1',
                ):
                    raise ValueError(
                        'Bootstrap admission is complete. Use existing-account operator recovery.'
                    )
                await c.execute(
                    'UPDATE sb_invitations SET revoked=true WHERE bootstrap AND used_by IS NULL AND NOT revoked'
                )
            elif issued:
                raise ValueError('Instance already bootstrapped.')
            if not issued:
                await c.execute('INSERT INTO sb_instance(id) VALUES (1)')
        elif not await one(c, 'SELECT id FROM sb_workspaces WHERE id=%s', (workspace_id,)):
            raise ValueError('Workspace not found.')
        await c.execute(
            "INSERT INTO sb_invitations(id,email,token_hash,workspace_id,role,bootstrap,expires_at) VALUES (%s,%s,%s,%s,%s,%s,now()+interval '24 hours')",
            (
                invite_id,
                address,
                token_hash(token),
                workspace_id,
                'owner' if bootstrap else role,
                bootstrap,
            ),
        )
    return {'id': invite_id, 'token': token, 'email': address}


async def admit(c, user_id, address, token=None):
    await c.execute('SELECT pg_advisory_xact_lock(%s)', (BOOTSTRAP_LOCK,))
    invite = await invitation(c, address, token, True)
    if not invite:
        raise ServiceError(403, 'Invitation is invalid, expired or already used.')
    workspace_id = invite['workspace_id'] or uuid4()
    if not invite['workspace_id']:
        await c.execute(
            'INSERT INTO sb_workspaces(id,name) VALUES (%s,%s)',
            (workspace_id, 'SwiftBuild workspace'),
        )
    await c.execute(
        'INSERT INTO sb_admitted_users(user_id,administrator) VALUES (%s,%s) ON CONFLICT(user_id) DO NOTHING',
        (user_id, invite['bootstrap']),
    )
    if not await active(c, user_id, True):
        raise ServiceError(403, 'Account is unavailable.')
    await c.execute(
        'INSERT INTO sb_members(workspace_id,user_id,role) VALUES (%s,%s,%s) ON CONFLICT(workspace_id,user_id) DO NOTHING',
        (workspace_id, user_id, invite['role']),
    )
    await c.execute(
        'UPDATE sb_invitations SET used_by=%s,used_at=now() WHERE id=%s', (user_id, invite['id'])
    )
    await c.execute(
        "INSERT INTO sb_audit_events(id,workspace_id,actor_id,action) VALUES (%s,%s,%s,'invitation.accepted')",
        (uuid4(), workspace_id, user_id),
    )


class Identity:
    def __init__(self, pool, settings):
        self.pool, self.settings = pool, settings
        # Hashing is expensive and must neither block ASGI nor exhaust its threadpool.
        self.hash_slots = asyncio.Semaphore(2)

    async def password(self, function, *args):
        async with self.hash_slots:
            return await asyncio.to_thread(function, *args)

    async def session(self, token):
        if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', token):
            return None
        async with self.pool.connection() as c:
            row = await one(
                c,
                'SELECT s.id AS session_id,s."createdAt" AS session_created,s."updatedAt" AS session_updated,s."ipAddress",s."userAgent",s."expiresAt",u.* FROM sb_auth_sessions s JOIN sb_auth_users u ON u.id=s."userId" JOIN sb_admitted_users a ON a.user_id=u.id AND a.active WHERE s.token=%s AND s."expiresAt">now()',
                (token,),
            )
            refreshed = False
            if (
                row
                and (datetime.now(timezone.utc) - row['session_updated']).total_seconds() >= 3600
            ):
                refreshed_row = await one(
                    c,
                    'UPDATE sb_auth_sessions SET "updatedAt"=now(),"expiresAt"=now()+interval \'24 hours\' WHERE token=%s AND "expiresAt">now() RETURNING "updatedAt","expiresAt"',
                    (token,),
                )
                if not refreshed_row:
                    return None
                row['session_updated'], row['expiresAt'] = (
                    refreshed_row['updatedAt'],
                    refreshed_row['expiresAt'],
                )
                refreshed = True
        if not row:
            return None
        return {
            '_refresh': refreshed,
            'user': public_user(row),
            'session': {
                'id': row['session_id'],
                'userId': row['id'],
                'token': token,
                'ipAddress': row['ipAddress'],
                'userAgent': row['userAgent'],
                'createdAt': row['session_created'],
                'updatedAt': row['session_updated'],
                'expiresAt': row['expiresAt'],
            },
        }

    async def rate_limit(self, path, address):
        maximum = 5 if path in ('sign-in/email', 'sign-up/email', 'reset-password') else 100
        key = token_hash(path + ':' + address)
        now = int(time.time() * 1000)
        async with transaction(self.pool) as c:
            row = await one(
                c,
                'INSERT INTO sb_auth_limits(id,key,count,"lastRequest") VALUES (%s,%s,1,%s) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN sb_auth_limits."lastRequest"<%s THEN 1 ELSE sb_auth_limits.count+1 END,"lastRequest"=CASE WHEN sb_auth_limits."lastRequest"<%s THEN %s ELSE sb_auth_limits."lastRequest" END RETURNING count',
                (str(uuid4()), key, now, now - 60000, now - 60000, now),
            )
        if row['count'] > maximum:
            raise ServiceError(429, 'Too many attempts. Wait at least one minute.', 'RATE_LIMIT')

    async def create_account(self, address, password, label, token):
        address, label = email(address), name(label)
        if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', token):
            raise ServiceError(403, 'A valid invitation is required.')
        encoded = await self.password(hash_password, password)
        user_id = str(uuid4())
        async with transaction(self.pool) as c:
            # Same lock order as rotation and authoritative admission.
            await c.execute('SELECT pg_advisory_xact_lock(%s)', (BOOTSTRAP_LOCK,))
            if not await invitation(c, address, token, True):
                raise ServiceError(403, 'A valid invitation is required.')
            if await one(c, 'SELECT id FROM sb_auth_users WHERE email=%s', (address,)):
                raise ServiceError(422, 'Account already exists.')
            created = await one(
                c,
                'INSERT INTO sb_auth_users(id,name,email,"emailVerified","createdAt","updatedAt") VALUES (%s,%s,%s,false,now(),now()) RETURNING *',
                (user_id, label, address),
            )
            await c.execute(
                'INSERT INTO sb_auth_accounts(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES (%s,%s,\'credential\',%s,%s,now(),now())',
                (str(uuid4()), user_id, user_id, encoded),
            )
            await admit(c, user_id, address, token)
        return {
            'token': None,
            'user': public_user(created),
        }

    async def sign_in(self, address, password, token=None):
        address = email(address)
        async with self.pool.connection() as c:
            row = await one(
                c,
                'SELECT u.*,a.password FROM sb_auth_users u JOIN sb_auth_accounts a ON a."userId"=u.id AND a."providerId"=\'credential\' WHERE u.email=%s',
                (address,),
            )
        encoded = row['password'] if row else '0' * 32 + ':' + '0' * 128
        correct = await self.password(verify_password, encoded, password)
        if not row or not correct:
            raise ServiceError(401, 'Invalid credentials.', 'INVALID_EMAIL_OR_PASSWORD')
        async with transaction(self.pool) as c:
            if token:
                await c.execute('SELECT pg_advisory_xact_lock(%s)', (BOOTSTRAP_LOCK,))
            if not await active(c, row['id'], True):
                if not token:
                    raise ServiceError(401, 'Invalid credentials.')
                await admit(c, row['id'], address, token)
            elif token and await invitation(c, address, token):
                await admit(c, row['id'], address, token)
            session_token = await self.new_session(c, row['id'])
        return session_token, {
            'redirect': False,
            'token': session_token,
            'user': public_user(row),
        }

    async def new_session(self, c, user_id):
        token = secrets.token_urlsafe(32)
        await c.execute(
            'INSERT INTO sb_auth_sessions(id,token,"userId","createdAt","updatedAt","expiresAt") VALUES (%s,%s,%s,now(),now(),now()+interval \'24 hours\')',
            (str(uuid4()), token, user_id),
        )
        return token

    async def sign_out(self, token):
        async with self.pool.connection() as c:
            await c.execute('DELETE FROM sb_auth_sessions WHERE token=%s', (token,))

    async def accept_invitation(self, session, token):
        if not session:
            raise ServiceError(401, 'Sign in to accept this invitation.')
        async with transaction(self.pool) as c:
            await admit(c, session['user']['id'], session['user']['email'], token)

    async def issue_recovery(self, address):
        address, token = email(address), secrets.token_urlsafe(32)
        async with transaction(self.pool) as c:
            row = await one(
                c,
                'SELECT u.id FROM sb_auth_users u JOIN sb_admitted_users a ON a.user_id=u.id AND a.active WHERE u.email=%s',
                (address,),
            )
            if not row:
                return None
            await c.execute(
                'INSERT INTO sb_auth_verifications(id,identifier,value,"expiresAt","createdAt","updatedAt") VALUES (%s,%s,%s,now()+interval \'1 hour\',now(),now())',
                (str(uuid4()), verification_key(token), row['id']),
            )
        return token

    async def reset_password(self, token, password):
        if not isinstance(token, str) or not 1 <= len(token) <= 128:
            raise ServiceError(400, 'Invalid token.', 'INVALID_TOKEN')
        encoded = await self.password(hash_password, password)
        async with transaction(self.pool) as c:
            row = await one(
                c,
                'DELETE FROM sb_auth_verifications WHERE identifier=%s AND "expiresAt">now() RETURNING value',
                (verification_key(token),),
            )
            if not row or not await active(c, row['value'], True):
                raise ServiceError(400, 'Invalid token.', 'INVALID_TOKEN')
            account = await one(
                c,
                'SELECT id FROM sb_auth_accounts WHERE "userId"=%s AND "providerId"=\'credential\' FOR UPDATE',
                (row['value'],),
            )
            if account:
                await c.execute(
                    'UPDATE sb_auth_accounts SET password=%s,"updatedAt"=now() WHERE id=%s',
                    (encoded, account['id']),
                )
            else:
                await c.execute(
                    'INSERT INTO sb_auth_accounts(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES (%s,%s,\'credential\',%s,%s,now(),now())',
                    (str(uuid4()), row['value'], row['value'], encoded),
                )
            await c.execute('DELETE FROM sb_auth_sessions WHERE "userId"=%s', (row['value'],))

    async def list_accounts(self, session):
        async with self.pool.connection() as c:
            rows = await all_rows(
                c,
                'SELECT id,"providerId","accountId","userId","createdAt","updatedAt",scope FROM sb_auth_accounts WHERE "userId"=%s',
                (session['user']['id'],),
            )
        return rows

    async def unlink_account(self, session, provider, account_id=None):
        async with transaction(self.pool) as c:
            user_id = session['user']['id']
            await c.execute('SELECT id FROM sb_auth_users WHERE id=%s FOR UPDATE', (user_id,))
            rows = await all_rows(
                c,
                'SELECT id,"providerId","accountId" FROM sb_auth_accounts WHERE "userId"=%s',
                (user_id,),
            )
            matching = [
                r
                for r in rows
                if r['providerId'] == provider
                and (account_id is None or r['accountId'] == account_id)
            ]
            if not matching or len(matching) == len(rows):
                raise ServiceError(400, 'Cannot remove the last sign-in method.')
            for row in matching:
                await c.execute('DELETE FROM sb_auth_accounts WHERE id=%s', (row['id'],))

    async def change_password(self, session, body):
        from datetime import datetime, timezone

        if (datetime.now(timezone.utc) - session['session']['createdAt']).total_seconds() > 300:
            raise ServiceError(401, 'A fresh sign-in is required.')
        user_id = session['user']['id']
        async with self.pool.connection() as c:
            account = await one(
                c,
                'SELECT id,password FROM sb_auth_accounts WHERE "userId"=%s AND "providerId"=\'credential\'',
                (user_id,),
            )
        if not account or not await self.password(
            verify_password, account['password'], body.get('currentPassword')
        ):
            raise ServiceError(400, 'Invalid password.')
        encoded = await self.password(hash_password, body.get('newPassword'))
        async with transaction(self.pool) as c:
            if not await active(c, user_id, True):
                raise ServiceError(403, 'Account is unavailable.')
            # Concurrent changes must not both authenticate against an obsolete hash.
            updated = await c.execute(
                'UPDATE sb_auth_accounts SET password=%s,"updatedAt"=now() WHERE id=%s AND password=%s',
                (encoded, account['id'], account['password']),
            )
            if not updated.rowcount:
                raise ServiceError(409, 'Credentials changed. Sign in again.')
            if body.get('revokeOtherSessions'):
                await c.execute(
                    'DELETE FROM sb_auth_sessions WHERE "userId"=%s AND id<>%s',
                    (user_id, session['session']['id']),
                )
        return {'token': None, 'user': session['user']}
