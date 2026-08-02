\set ON_ERROR_STOP on

SELECT
  :'caas_role' ~ '^[a-z][a-z0-9_]{2,62}$' AS caas_identifier_valid,
  :'dsaas_role' ~ '^[a-z][a-z0-9_]{2,62}$' AS dsaas_identifier_valid,
  :'caas_role' <> :'dsaas_role' AS roles_are_distinct,
  current_database() AS database_name
\gset

\if :caas_identifier_valid
\else
  \echo 'CaaS runtime role identifier is invalid'
  \quit 3
\endif
\if :dsaas_identifier_valid
\else
  \echo 'DSaaS runtime role identifier is invalid'
  \quit 3
\endif
\if :roles_are_distinct
\else
  \echo 'runtime roles must be distinct'
  \quit 3
\endif

BEGIN;
ALTER ROLE :"caas_role" NOLOGIN;
ALTER ROLE :"dsaas_role" NOLOGIN;
REVOKE CONNECT ON DATABASE :"database_name" FROM :"caas_role", :"dsaas_role";
COMMIT;

SELECT pg_terminate_backend(pid)
FROM pg_catalog.pg_stat_activity
WHERE usename IN (:'caas_role', :'dsaas_role')
  AND pid <> pg_backend_pid();

SELECT count(*) = 0 AS runtime_sessions_drained
FROM pg_catalog.pg_stat_activity
WHERE usename IN (:'caas_role', :'dsaas_role')
  AND pid <> pg_backend_pid()
\gset

\if :runtime_sessions_drained
\else
  \echo 'runtime database sessions remained after the cutover fence'
  \quit 4
\endif

SELECT count(*) = 2 AS runtime_roles_fenced
FROM pg_catalog.pg_roles
WHERE rolname IN (:'caas_role', :'dsaas_role')
  AND NOT rolcanlogin
\gset

\if :runtime_roles_fenced
\else
  \echo 'runtime roles were not fenced with NOLOGIN'
  \quit 4
\endif
