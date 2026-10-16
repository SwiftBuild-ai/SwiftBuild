import os
from dataclasses import dataclass
from urllib.parse import urlsplit


def configured_url(value, allow_local_http=False, origin_only=False):
    url = urlsplit(value)
    # Accessing port also rejects malformed/out-of-range values.
    _ = url.port
    if (
        not url.hostname
        or url.username
        or url.password
        or url.query
        or url.fragment
        or (
            url.scheme != 'https'
            and not (
                allow_local_http
                and url.scheme == 'http'
                and url.hostname in ('localhost', '127.0.0.1', '::1')
            )
        )
        or (origin_only and url.path not in ('', '/'))
    ):
        raise ValueError(
            'Identity URLs require HTTPS; explicit local HTTP is allowed only for loopback development.'
        )
    return value.rstrip('/') if origin_only else value


@dataclass(frozen=True)
class Settings:
    database_url: str
    url: str
    secret: str
    allow_local_http: bool = False
    oidc_discovery_url: str = ''
    oidc_client_id: str = ''
    oidc_client_secret: str = ''
    computation_enabled: bool = False
    computation_url: str = ''
    computation_token: str = ''

    def __post_init__(self):
        configured_url(self.url, self.allow_local_http, origin_only=True)
        if len(self.secret) < 32:
            raise ValueError('Authentication secret must contain at least 32 characters.')
        oidc = (self.oidc_discovery_url, self.oidc_client_id, self.oidc_client_secret)
        if any(oidc) and not all(oidc):
            raise ValueError('Organizational sign-in requires all three OIDC settings.')
        if self.oidc_discovery_url:
            configured_url(self.oidc_discovery_url, self.allow_local_http)

    @property
    def origin(self):
        url = urlsplit(self.url)
        host = '[' + url.hostname + ']' if ':' in url.hostname else url.hostname
        port = url.port
        suffix = (
            ''
            if port is None or (url.scheme, port) in (('https', 443), ('http', 80))
            else ':' + str(port)
        )
        return url.scheme + '://' + host + suffix

    @property
    def secure(self):
        return urlsplit(self.url).scheme == 'https'

    @classmethod
    def from_env(cls):
        return cls(
            os.environ['DATABASE_URL'],
            os.environ['SWIFTBUILD_URL'],
            os.environ['SWIFTBUILD_AUTH_SECRET'],
            os.getenv('SWIFTBUILD_ALLOW_LOCAL_HTTP') == '1',
            os.getenv('SWIFTBUILD_OIDC_DISCOVERY_URL', ''),
            os.getenv('SWIFTBUILD_OIDC_CLIENT_ID', ''),
            os.getenv('SWIFTBUILD_OIDC_CLIENT_SECRET', ''),
            os.getenv('SWIFTBUILD_COMPUTATION_ENABLED') == '1',
            os.getenv('SWIFTBUILD_COMPUTATION_URL', ''),
            os.getenv('SWIFTBUILD_COMPUTATION_TOKEN', ''),
        )
