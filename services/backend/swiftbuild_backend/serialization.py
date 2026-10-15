"""Legacy project JSON and computation JCS deliberately have different contracts."""

import hashlib
import json
import math

import jcs


def utf16(value: str) -> bytes:
    return value.encode('utf-16-be', errors='surrogatepass')


def js_json(value, *, sort_keys=False, indent=None):
    """ECMAScript JSON.stringify ordering/numbers, including integer property keys."""

    def dump(item, depth=0):
        if item is None:
            return 'null'
        if isinstance(item, bool):
            return 'true' if item else 'false'
        if isinstance(item, (int, float)):
            if not math.isfinite(item):
                return 'null'
            return jcs.canonicalize(float(item)).decode()
        if isinstance(item, str):
            # JSON.stringify emits literal Unicode except unpaired UTF-16 surrogates.
            return (
                json.dumps(item, ensure_ascii=False)
                .encode('utf-8', errors='backslashreplace')
                .decode()
            )
        if isinstance(item, list):
            parts = [dump(v, depth + 1) for v in item]
            opening, closing = '[', ']'
        elif isinstance(item, dict):
            keys = sorted(item, key=utf16) if sort_keys else list(item)

            def index(k):
                return k.isascii() and k.isdigit() and str(int(k)) == k and int(k) < 4294967295

            numeric = sorted((k for k in keys if index(k)), key=int)
            keys = numeric + [k for k in keys if not index(k)]
            parts = [dump(k) + (': ' if indent else ':') + dump(item[k], depth + 1) for k in keys]
            opening, closing = '{', '}'
        else:
            raise ValueError('Value is not JSON.')
        if not parts:
            return opening + closing
        if indent:
            pad = ' ' * (indent * (depth + 1))
            return (
                opening
                + '\n'
                + pad
                + (',\n' + pad).join(parts)
                + '\n'
                + ' ' * (indent * depth)
                + closing
            )
        return opening + ','.join(parts) + closing

    return dump(value)


def project_digest(archive):
    return hashlib.sha256(
        js_json({k: v for k, v in archive.items() if k != 'exportedAt'}, sort_keys=True).encode()
    ).hexdigest()


def computation_digest(value):
    return hashlib.sha256(jcs.canonicalize(value)).hexdigest()
