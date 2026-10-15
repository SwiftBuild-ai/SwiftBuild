"""Public FastAPI contracts. Domain actors always originate in verified sessions."""

import json
import logging
import re
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Annotated, Literal
from urllib.parse import urlencode, urljoin, urlsplit
from uuid import uuid4

from fastapi import Depends, FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse, Response
from jsonschema import ValidationError as SchemaError
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

from .config import Settings
from .database import check_migrations, one, pool_for
from .domain import MAX_ARCHIVE_BYTES, MAX_COMPUTATION_BYTES, validate_archive
from .errors import ServiceError
from .identity import COOKIE, Identity
from .jobs import Jobs
from .projects import Projects, identifier, name as normalized_name
from .serialization import js_json

log = logging.getLogger('swiftbuild')
ID = Annotated[
    str,
    Field(
        pattern=r'^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$'
    ),
]


class Input(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')


class WorkspaceInput(Input):
    name: Annotated[str, BeforeValidator(normalized_name)] = Field(min_length=1, max_length=120)


class CreateProjectInput(Input):
    workspaceId: ID
    operationId: ID
    archive: Any
    expectedActorId: str | None = Field(default=None, min_length=1, max_length=128)


class SaveInput(Input):
    operationId: ID
    archive: Any


class RestoreInput(Input):
    operationId: ID
    sourceRevision: Annotated[
        int,
        BeforeValidator(
            lambda value: int(value) if type(value) is float and value.is_integer() else value
        ),
    ] = Field(ge=1, le=2147483646)
    expectedActorId: str | None = Field(default=None, min_length=1, max_length=128)


class JobInput(Input):
    operationId: ID
    input: Any
    imported: bool = False


class InvitationInput(Input):
    token: str = Field(min_length=1, max_length=128)


class ProjectOutput(BaseModel):
    id: str
    workspaceId: str
    revision: int
    archive: dict[str, Any]
    role: Literal['owner', 'editor', 'viewer'] | None = None


class WorkspaceOutput(BaseModel):
    id: str
    name: str
    role: Literal['owner', 'editor', 'viewer']


class WorkspacePage(BaseModel):
    items: list[WorkspaceOutput]
    nextCursor: str | None


class SessionUser(BaseModel):
    id: str
    name: str
    email: str


class SessionOutput(BaseModel):
    user: SessionUser
    oidc: bool


class JobOutput(BaseModel):
    id: str
    projectId: str
    revision: int
    state: Literal[
        'queued',
        'running',
        'cancelling',
        'completed',
        'partial',
        'cancelled',
        'failed',
        'timed-out',
    ]
    input: dict[str, Any]
    report: dict[str, Any] | None
    error: str | None
    origin: Literal['computed', 'imported']


def reply(value, status=200, headers=None):
    return JSONResponse(
        jsonable_encoder(
            value,
            custom_encoder={
                datetime: lambda value: value.isoformat(timespec='milliseconds').replace(
                    '+00:00', 'Z'
                )
            },
        ),
        status_code=status,
        headers=headers,
    )


def error_response(request_id, status, code, message, auth=False):
    body = (
        {'code': code, 'message': message}
        if auth
        else {'error': {'code': code, 'message': message}, 'requestId': request_id}
    )
    return reply(body, status, {'cache-control': 'no-store', 'x-request-id': request_id})


def expected(request):
    tag = request.headers.get('if-match')
    if not tag:
        raise ServiceError(428, 'A current revision is required in If-Match.', 'REVISION_REQUIRED')
    if not re.fullmatch(r'"[1-9][0-9]*"', tag) or int(tag[1:-1]) > 2147483646:
        raise ServiceError(400, 'Use a single strong quoted revision tag.', 'INVALID_REVISION')
    return int(tag[1:-1])


def version(value):
    if not value or not value.isascii() or not value.isdigit() or not 1 <= int(value) <= 2147483646:
        raise ValueError('Invalid revision.')
    return int(value)


def archive_input(value):
    try:
        return validate_archive(value)
    except (ValueError, SchemaError, TypeError, KeyError):
        raise ServiceError(
            400, 'Project archive is invalid or exceeds its byte limit.', 'INVALID_ARCHIVE'
        ) from None


class Boundaries:
    """Bound actual ASGI bytes before FastAPI parses a request or validates a model."""

    def __init__(self, app, settings):
        self.app, self.settings = app, settings

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        request_id = str(uuid4())
        scope['swiftbuild.request_id'] = request_id
        path, method = scope['path'], scope['method']
        auth = path.startswith('/api/auth/')
        headers = {k.decode().lower(): v.decode() for k, v in scope['headers']}

        async def respond(status, code, message):
            response = error_response(request_id, status, code, message, auth)
            await response(scope, receive, send)

        if method not in ('GET', 'HEAD', 'OPTIONS'):
            if headers.get('origin') != self.settings.origin:
                return await respond(403, 'UNTRUSTED_ORIGIN', 'A same-origin request is required.')
            cancellation = bool(re.fullmatch(r'/api/v1/projects/[^/]+/jobs/[^/]+/cancel', path))
            if (
                not cancellation
                and headers.get('content-type', '').split(';')[0].strip() != 'application/json'
            ):
                return await respond(415, 'CONTENT_TYPE', 'Use application/json.')
            limit = 16384
            if re.fullmatch(r'/api/v1/projects(?:/[^/]+)?', path):
                limit = MAX_ARCHIVE_BYTES + 65536
            if '/jobs' in path:
                limit = MAX_COMPUTATION_BYTES
            if path.endswith('/restore'):
                limit = 4096
            raw = bytearray()
            while True:
                part = await receive()
                if part['type'] == 'http.disconnect':
                    return
                raw.extend(part.get('body', b''))
                if len(raw) > limit:
                    return await respond(
                        413, 'INPUT_LIMIT', 'Input exceeds the allowed byte limit.'
                    )
                if not part.get('more_body'):
                    break
            if not cancellation:
                try:

                    def invalid_constant(value):
                        raise ValueError('Non-finite JSON.')

                    json.loads(raw.decode('utf-8'), parse_constant=invalid_constant)
                except (ValueError, UnicodeError, RecursionError):
                    return await respond(400, 'INVALID_JSON', 'Input must be valid UTF-8 JSON.')
            original_receive, delivered = receive, False

            async def replay():
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {'type': 'http.request', 'body': bytes(raw), 'more_body': False}
                return await original_receive()

            receive = replay

        response_started = False

        async def send_headers(message):
            nonlocal response_started
            if message['type'] == 'http.response.start':
                response_started = True
                # Replace rather than append policy headers to prevent cache ambiguity.
                result = [
                    (k, v)
                    for k, v in message.get('headers', [])
                    if k.lower() not in (b'cache-control', b'x-request-id')
                ]
                message['headers'] = result + [
                    (b'cache-control', b'no-store'),
                    (b'x-request-id', request_id.encode()),
                ]
            await send(message)

        try:
            await self.app(scope, receive, send_headers)
        except Exception:
            if response_started:
                raise
            log.error(
                json.dumps(
                    {
                        'event': 'server.request.failed',
                        'requestId': request_id,
                        'status': 503,
                        'code': 'STORAGE_UNAVAILABLE',
                    }
                )
            )
            return await respond(
                503,
                'STORAGE_UNAVAILABLE',
                'Server storage is unavailable. Preserve local work and retry.',
            )


def create_app(settings: Settings, *, pool=None):
    database = pool if pool is not None else pool_for(settings.database_url)
    identity, projects, jobs = Identity(database, settings), Projects(database), Jobs(database)

    @asynccontextmanager
    async def lifespan(app):
        if pool is None:
            await database.open()
        try:
            yield
        finally:
            if pool is None:
                await database.close()

    app = FastAPI(
        title='SwiftBuild API',
        version='1.0',
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.identity, app.state.projects, app.state.jobs, app.state.pool = (
        identity,
        projects,
        jobs,
        database,
    )
    app.add_middleware(Boundaries, settings=settings)

    @app.exception_handler(ServiceError)
    async def service_error(request, error):
        return error_response(
            request.scope['swiftbuild.request_id'],
            412 if error.code == 'REVISION_CONFLICT' else error.status,
            error.code,
            error.message,
            request.url.path.startswith('/api/auth/'),
        )

    async def invalid_input(request, error):
        return error_response(
            request.scope['swiftbuild.request_id'],
            400,
            'INVALID_INPUT',
            'Request fields are invalid.',
            request.url.path.startswith('/api/auth/'),
        )

    app.add_exception_handler(RequestValidationError, invalid_input)
    app.add_exception_handler(ValueError, invalid_input)
    app.add_exception_handler(SchemaError, invalid_input)
    app.add_exception_handler(RecursionError, invalid_input)

    async def session(request: Request):
        result = await identity.session(request.cookies.get(COOKIE))
        if not result:
            raise ServiceError(401, 'Sign in to access server projects.', 'AUTH_REQUIRED')
        return result

    User = Annotated[dict, Depends(session)]

    @app.get('/api/health')
    async def health():
        return {'status': 'ok'}

    @app.get('/api/v1/ready')
    async def ready():
        async with database.connection() as c:
            try:
                await check_migrations(c)
            except ValueError:
                raise ServiceError(
                    503, 'Apply the migrations for this server version.', 'MIGRATIONS_REQUIRED'
                ) from None
            if settings.computation_enabled and not await one(
                c,
                "SELECT 1 FROM sb_worker_heartbeats WHERE updated_at>now()-interval '30 seconds' LIMIT 1",
            ):
                raise ServiceError(
                    503, 'The computation dispatcher is unavailable.', 'WORKER_UNAVAILABLE'
                )
        return {'status': 'ready'}

    @app.get('/api/v1/session', response_model=SessionOutput)
    async def current(user: User):
        return {
            'user': {k: user['user'][k] for k in ('id', 'name', 'email')},
            'oidc': bool(settings.oidc_discovery_url),
        }

    @app.get('/api/v1/workspaces', response_model=WorkspacePage)
    async def workspaces(request: Request, user: User):
        items = await projects.list_workspaces(
            user['user']['id'], request.query_params.get('after')
        )
        return {'items': items, 'nextCursor': items[-1]['id'] if len(items) == 100 else None}

    @app.post('/api/v1/workspaces', status_code=201)
    async def create_workspace(body: WorkspaceInput, user: User):
        return await projects.create_workspace(user['user']['id'], body.name)

    @app.get('/api/v1/projects')
    async def list_projects(request: Request, user: User):
        query = request.query_params
        workspace_id = identifier(query.get('workspaceId'))
        if bool(query.get('afterId')) != bool(query.get('beforeUpdatedAt')):
            raise ServiceError(400, 'Both project cursor fields are required.', 'INVALID_CURSOR')
        before = None
        if query.get('afterId'):
            timestamp = query['beforeUpdatedAt']
            if not timestamp.endswith('Z'):
                raise ValueError('Invalid cursor timestamp.')
            datetime.fromisoformat(timestamp)
            before = {'id': identifier(query['afterId']), 'updatedAt': timestamp}
        items = await projects.list_projects(user['user']['id'], workspace_id, before)
        return {
            'items': items,
            'nextCursor': {k: items[-1][k] for k in ('id', 'updatedAt')}
            if len(items) == 100
            else None,
        }

    @app.post(
        '/api/v1/projects',
        response_model=ProjectOutput,
        status_code=201,
        response_model_exclude_unset=True,
    )
    async def create_project(body: CreateProjectInput, user: User):
        if body.expectedActorId is not None and body.expectedActorId != user['user']['id']:
            raise ServiceError(
                403,
                'The signed-in account changed. Creation recovery is preserved.',
                'ACTOR_CHANGED',
            )
        project = await projects.create_project(
            user['user']['id'], body.workspaceId, archive_input(body.archive), body.operationId
        )
        return reply(project, 201, {'etag': f'"{project["revision"]}"'})

    @app.get(
        '/api/v1/projects/{project_id}',
        response_model=ProjectOutput,
        response_model_exclude_unset=True,
    )
    async def read_project(project_id: str, request: Request, user: User):
        query = request.query_params.get('revision')
        project = await projects.read_project(
            user['user']['id'], project_id, version(query) if query else None
        )
        return reply(project, headers={'etag': f'"{project["revision"]}"'})

    @app.put(
        '/api/v1/projects/{project_id}',
        response_model=ProjectOutput,
        response_model_exclude_unset=True,
    )
    async def save_project(project_id: str, body: SaveInput, request: Request, user: User):
        project = await projects.save_project(
            user['user']['id'],
            project_id,
            expected(request),
            archive_input(body.archive),
            body.operationId,
        )
        return reply(project, headers={'etag': f'"{project["revision"]}"'})

    @app.post(
        '/api/v1/projects/{project_id}/restore',
        response_model=ProjectOutput,
        response_model_exclude_unset=True,
    )
    async def restore(project_id: str, body: RestoreInput, request: Request, user: User):
        if body.expectedActorId is not None and body.expectedActorId != user['user']['id']:
            raise ServiceError(
                403,
                'The signed-in account changed. Restore recovery is preserved.',
                'ACTOR_CHANGED',
            )
        project = await projects.restore_project(
            user['user']['id'], project_id, expected(request), body.sourceRevision, body.operationId
        )
        return reply(project, headers={'etag': f'"{project["revision"]}"'})

    @app.get('/api/v1/projects/{project_id}/revisions')
    async def revisions(project_id: str, request: Request, user: User):
        query = request.query_params.get('before')
        items = await projects.list_revisions(
            user['user']['id'], project_id, version(query) if query else None
        )
        return {'items': items, 'nextCursor': items[-1]['revision'] if len(items) == 100 else None}

    @app.get('/api/v1/projects/{project_id}/export')
    async def export(project_id: str, user: User):
        project = await projects.read_project(user['user']['id'], project_id)
        return Response(
            js_json(project['archive'], indent=2),
            media_type='application/json',
            headers={
                'content-disposition': f'attachment; filename="swiftbuild-project-{project_id}.json"'
            },
        )

    @app.post('/api/v1/invitations/accept')
    async def accept(body: InvitationInput, user: User):
        await identity.accept_invitation(user, body.token)
        return {'status': 'accepted'}

    @app.post('/api/v1/projects/{project_id}/jobs', status_code=202, response_model=JobOutput)
    async def submit_job(project_id: str, body: JobInput, request: Request, user: User):
        return await jobs.submit(
            user['user']['id'],
            project_id,
            expected(request),
            body.operationId,
            body.input,
            body.imported,
        )

    @app.get('/api/v1/projects/{project_id}/jobs')
    async def list_jobs(project_id: str, request: Request, user: User):
        items = await jobs.list(user['user']['id'], project_id, request.query_params.get('before'))
        return {'items': items, 'nextCursor': items[-1]['id'] if len(items) == 100 else None}

    @app.get('/api/v1/projects/{project_id}/jobs/{job_id}', response_model=JobOutput)
    async def read_job(project_id: str, job_id: str, user: User):
        return await jobs.read(user['user']['id'], project_id, job_id)

    @app.post('/api/v1/projects/{project_id}/jobs/{job_id}/cancel')
    async def cancel_job(project_id: str, job_id: str, user: User):
        await jobs.cancel(user['user']['id'], project_id, job_id)
        return {'status': 'accepted'}

    @app.get('/api/v1/projects/{project_id}/jobs/{job_id}/export')
    async def export_job(project_id: str, job_id: str, user: User):
        return await jobs.export(user['user']['id'], project_id, job_id)

    def set_cookie(response, token):
        response.set_cookie(
            COOKIE,
            token,
            max_age=86400,
            httponly=True,
            secure=settings.secure,
            samesite='lax',
            path='/',
        )
        return response

    @app.api_route('/api/auth/{path:path}', methods=['GET', 'POST'], include_in_schema=False)
    async def auth(path: str, request: Request):
        address = request.client.host if request.client else 'unknown'
        if (
            path == 'callback/organization'
            and request.method == 'GET'
            and settings.oidc_discovery_url
        ):
            return await app.state.oauth_callback(request)
        if re.fullmatch(r'reset-password/[A-Za-z0-9_-]+', path) and request.method == 'GET':
            from .identity import verification_key

            token = path.split('/')[1]
            callback = urljoin(
                settings.origin + '/', request.query_params.get('callbackURL', '/reset-password')
            )
            if (
                urlsplit(callback).netloc != urlsplit(settings.origin).netloc
                or urlsplit(callback).scheme != urlsplit(settings.origin).scheme
            ):
                raise ServiceError(403, 'Untrusted callback URL.')
            async with database.connection() as c:
                valid = await one(
                    c,
                    'SELECT id FROM sb_auth_verifications WHERE identifier=%s AND "expiresAt">now()',
                    (verification_key(token),),
                )
            return RedirectResponse(
                callback
                + ('&' if '?' in callback else '?')
                + urlencode({'token': token} if valid else {'error': 'INVALID_TOKEN'}),
                status_code=302,
            )
        allowed = {
            'sign-in/email',
            'sign-up/email',
            'sign-in/social',
            'get-session',
            'sign-out',
            'reset-password',
            'link-social',
            'list-accounts',
            'unlink-account',
            'change-password',
        }
        if path not in allowed:
            raise ServiceError(404, 'Not found.', 'NOT_FOUND')
        if (request.method == 'GET') != (path in ('get-session', 'list-accounts')):
            raise ServiceError(404, 'Not found.', 'NOT_FOUND')
        await identity.rate_limit(path, address)
        body = await request.json() if request.method == 'POST' else {}
        if not isinstance(body, dict):
            raise ValueError('Invalid authentication input.')
        invitation_token = request.headers.get('x-swiftbuild-invitation')
        if path == 'sign-up/email':
            return await identity.create_account(
                body.get('email'), body.get('password'), body.get('name'), invitation_token
            )
        if path == 'sign-in/email':
            token, data = await identity.sign_in(
                body.get('email'), body.get('password'), invitation_token
            )
            return set_cookie(reply(data), token)
        if path == 'get-session':
            current = await identity.session(request.cookies.get(COOKIE))
            refreshed = current.pop('_refresh', False) if current else False
            response = reply(
                current,
                headers={'x-swiftbuild-oidc': '1' if settings.oidc_discovery_url else '0'},
            )
            return set_cookie(response, request.cookies[COOKIE]) if refreshed else response
        if path == 'sign-out':
            await identity.sign_out(request.cookies.get(COOKIE))
            response = reply({'success': True})
            response.delete_cookie(
                COOKIE, path='/', secure=settings.secure, httponly=True, samesite='lax'
            )
            return response
        if path == 'reset-password':
            await identity.reset_password(
                body.get('token') or request.query_params.get('token'), body.get('newPassword')
            )
            return {'status': True}
        user = await session(request) if path not in ('sign-in/social',) else None
        if path == 'list-accounts':
            return reply(await identity.list_accounts(user))
        if path == 'unlink-account':
            await identity.unlink_account(user, body.get('providerId'), body.get('accountId'))
            return {'status': True}
        if path == 'change-password':
            return await identity.change_password(user, body)
        if path in ('sign-in/social', 'link-social'):
            return await oauth_start(app, request, body, user, settings)
        raise ServiceError(404, 'Not found.', 'NOT_FOUND')

    if settings.oidc_discovery_url:
        from .oidc import configure_oidc

        configure_oidc(app, settings, identity, set_cookie)

    # Explicit documentation routes share the exact runtime handler. The catch-all
    # also handles provider/reset callbacks without exposing token-bearing URLs.
    def auth_endpoint(path):
        async def handle(request: Request):
            return await auth(path, request)

        return handle

    auth_inputs = {
        'sign-in/email': {'email': {'type': 'string'}, 'password': {'type': 'string'}},
        'sign-up/email': {
            'email': {'type': 'string'},
            'password': {'type': 'string'},
            'name': {'type': 'string'},
        },
        'reset-password': {'token': {'type': 'string'}, 'newPassword': {'type': 'string'}},
    }
    for path in (
        'sign-in/email',
        'sign-up/email',
        'sign-in/social',
        'get-session',
        'sign-out',
        'reset-password',
        'link-social',
        'list-accounts',
        'unlink-account',
        'change-password',
    ):
        schema = (
            {'type': 'object', 'properties': auth_inputs[path], 'required': list(auth_inputs[path])}
            if path in auth_inputs
            else {'type': 'object', 'additionalProperties': True}
        )
        method = 'GET' if path in ('get-session', 'list-accounts') else 'POST'
        extra = (
            {'requestBody': {'required': True, 'content': {'application/json': {'schema': schema}}}}
            if method == 'POST'
            else {}
        )
        app.add_api_route(
            '/api/auth/' + path,
            auth_endpoint(path),
            methods=[method],
            operation_id='auth_' + path.replace('/', '_').replace('-', '_'),
            openapi_extra=extra,
        )
    return app


async def oauth_start(app, request, body, user, settings):
    if not settings.oidc_discovery_url or body.get('provider') != 'organization':
        raise ServiceError(400, 'Organizational sign-in is unavailable.')
    callback = urljoin(settings.origin + '/', body.get('callbackURL', '/account'))
    if (
        urlsplit(callback).netloc != urlsplit(settings.origin).netloc
        or urlsplit(callback).scheme != urlsplit(settings.origin).scheme
    ):
        raise ServiceError(403, 'Untrusted callback URL.')
    request.session['swiftbuild_link_user'] = user['user']['id'] if user else None
    request.session['swiftbuild_callback'] = callback
    redirect = await app.state.oauth.organization.authorize_redirect(
        request, settings.origin + '/api/auth/callback/organization'
    )
    return {'url': redirect.headers['location'], 'redirect': True}
