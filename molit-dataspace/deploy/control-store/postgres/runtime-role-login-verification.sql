\set ON_ERROR_STOP on

SELECT
  :'caas_role' ~ '^[a-z][a-z0-9_]{2,62}$' AS caas_identifier_valid,
  :'dsaas_role' ~ '^[a-z][a-z0-9_]{2,62}$' AS dsaas_identifier_valid,
  current_database() AS database_name
\gset

\if :caas_identifier_valid
\else
  \quit 3
\endif
\if :dsaas_identifier_valid
\else
  \quit 3
\endif

SELECT count(*) = 2 AS runtime_roles_unfenced
FROM pg_catalog.pg_roles
WHERE rolname IN (:'caas_role', :'dsaas_role')
  AND rolcanlogin
  AND has_database_privilege(rolname, :'database_name', 'CONNECT')
\gset

\if :runtime_roles_unfenced
\else
  \quit 4
\endif
