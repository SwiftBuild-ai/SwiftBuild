"""Legacy project JSON and computation JCS deliberately have different contracts."""

import hashlib
import json
import math

import jcs


def utf16(value: str) -> bytes:
    return value.encode('utf-16-be', errors='surrogatepass')


def js_trim(value: str) -> str:
    # ECMAScript WhiteSpace + LineTerminator differs from Python's str.isspace:
    # it includes BOM and excludes NEL and the ASCII information separators.
    return value.strip(
        '\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680'
        '\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007'
        '\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
    )


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
