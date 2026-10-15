"""Native operator commands. One-time links are printed only for private delivery."""

import argparse
import asyncio
import json
import os
import sys
from urllib.parse import urlencode

from psycopg.conninfo import make_conninfo

from .config import Settings
from .database import migrate, one, pool_for
from .identity import Identity, issue_invitation
from .recovery import backup_database, grant_restored_runtime, restore_database, verify_backup


def parser():
    result = argparse.ArgumentParser(prog='swiftbuild-operator')
    commands = result.add_subparsers(dest='command', required=True)
    commands.add_parser('migrate')
    for operation in ('bootstrap', 'bootstrap-rotate', 'invite', 'recover'):
        sub = commands.add_parser(operation)
        sub.add_argument('--email', required=True)
        if operation == 'invite':
            sub.add_argument('--workspace', required=True)
            sub.add_argument('--role', choices=('owner', 'editor', 'viewer'), default='editor')
    for operation in ('backup', 'verify-backup', 'recovery-drill'):
        sub = commands.add_parser(operation)
        sub.add_argument('--directory', required=True)
        if operation == 'recovery-drill':
            sub.add_argument('--database', required=True)
    return result


async def run(args):
    if args.command == 'verify-backup':
        manifest = await asyncio.to_thread(verify_backup, args.directory)
        print(
            json.dumps(
                {'event': 'backup.verified', 'backupId': manifest['id'], 'bytes': manifest['bytes']}
            )
        )
        return
    connection = os.environ['DATABASE_URL']
    if args.command == 'backup':
        manifest = await backup_database(
            connection, args.directory, os.getenv('SWIFTBUILD_RELEASE_IMAGE', 'unrecorded')
        )
        print(
            json.dumps(
                {'event': 'backup.created', 'backupId': manifest['id'], 'bytes': manifest['bytes']}
            )
        )
        return
    if args.command == 'recovery-drill':
        password = os.getenv('SWIFTBUILD_DB_RUNTIME_PASSWORD')
        if not password:
            raise ValueError('Recovery drill requires the existing private runtime password.')
        report = await restore_database(connection, args.directory, args.database)
        admin = pool_for(make_conninfo(connection, dbname=args.database), maximum=1)
        await admin.open()
        try:
            await grant_restored_runtime(admin, args.database)
        finally:
            await admin.close()
        runtime = pool_for(
            make_conninfo(
                connection, dbname=args.database, user='swiftbuild_runtime', password=password
            ),
            maximum=1,
        )
        await runtime.open()
        try:
            async with runtime.connection() as c:
                await c.execute('SELECT id FROM public.sb_migrations')
                async with c.transaction():
                    await c.execute('UPDATE public.sb_projects SET name=name WHERE false')
                privileges = await one(
                    c,
                    "SELECT has_schema_privilege(current_user,'public','CREATE') AS ddl,has_table_privilege(current_user,'public.sb_migrations','UPDATE') AS migration_write",
                )
                if any(privileges.values()):
                    raise ValueError('Restored runtime role has excessive privileges.')
        finally:
            await runtime.close()
        print(
            json.dumps(
                {
                    'event': 'recovery.drill.passed',
                    'backupId': report['backupId'],
                    'checks': [
                        'backup-integrity',
                        'migration-compatibility',
                        'snapshot-row-inventory',
                        'runtime-read-write',
                        'no-runtime-ddl-or-migration-write',
                    ],
                }
            )
        )
        return
    pool = pool_for(connection, maximum=4)
    await pool.open()
    try:
        if args.command == 'migrate':
            await migrate(pool)
            print('SwiftBuild database migrations applied.')
            return
        settings = Settings.from_env()
        if args.command == 'recover':
            token = await Identity(pool, settings).issue_recovery(args.email)
            if token:
                print(
                    settings.origin
                    + '/api/auth/reset-password/'
                    + token
                    + '?'
                    + urlencode({'callbackURL': settings.origin + '/reset-password'})
                )
            print(
                'Recovery requested. A one-time link is printed only for an eligible existing account.'
            )
        else:
            link = await issue_invitation(
                pool,
                args.email,
                bootstrap=args.command.startswith('bootstrap'),
                rotate=args.command == 'bootstrap-rotate',
                workspace_id=getattr(args, 'workspace', None),
                role=getattr(args, 'role', 'editor'),
            )
            print(
                settings.origin
                + '/invite?'
                + urlencode({'token': link['token'], 'email': link['email']})
            )
    finally:
        await pool.close()


def main():
    args = parser().parse_args()
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    try:
        asyncio.run(run(args))
    except Exception as error:
        # Driver/subprocess errors may contain credentials. Never print tracebacks here.
        if isinstance(error, ValueError):
            print(str(error), file=sys.stderr)
        else:
            print(
                'Operator command failed. Check configuration, database access and private tooling.',
                file=sys.stderr,
            )
        raise SystemExit(1) from None


if __name__ == '__main__':
    main()
