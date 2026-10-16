#!/bin/sh
set -eu
python -m swiftbuild_backend.cli migrate
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v runtime_password="$SWIFTBUILD_DB_RUNTIME_PASSWORD" -v database_name="$SWIFTBUILD_DB_NAME" <<'SQL'
SELECT 'CREATE ROLE swiftbuild_runtime LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='swiftbuild_runtime') \gexec
ALTER ROLE swiftbuild_runtime PASSWORD :'runtime_password';
GRANT CONNECT ON DATABASE :"database_name" TO swiftbuild_runtime;
GRANT USAGE ON SCHEMA public TO swiftbuild_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO swiftbuild_runtime;
REVOKE ALL ON sb_migrations FROM swiftbuild_runtime;
GRANT SELECT ON sb_migrations TO swiftbuild_runtime;
SQL
