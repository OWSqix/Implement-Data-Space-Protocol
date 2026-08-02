\set ON_ERROR_STOP on

SELECT
  :'caas_role' ~ '^[a-z][a-z0-9_]{2,62}$' AS caas_identifier_valid,
  :'dsaas_role' ~ '^[a-z][a-z0-9_]{2,62}$' AS dsaas_identifier_valid,
  :'caas_role' <> :'dsaas_role' AS roles_are_distinct,
  :'approved_by' ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,127}$' AS approver_valid,
  :'approval_reference' ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{7,255}$' AS approval_reference_valid
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
  \echo 'CaaS and DSaaS runtime roles must be distinct'
  \quit 3
\endif
\if :approver_valid
\else
  \echo 'database bootstrap approver is invalid'
  \quit 3
\endif
\if :approval_reference_valid
\else
  \echo 'database bootstrap approval reference is invalid'
  \quit 3
\endif

SELECT count(*) = 2 AS runtime_roles_valid
FROM pg_catalog.pg_roles
WHERE rolname IN (:'caas_role', :'dsaas_role')
  AND NOT rolsuper
  AND NOT rolcreatedb
  AND NOT rolcreaterole
  AND NOT rolreplication
  AND NOT rolbypassrls
\gset

\if :runtime_roles_valid
\else
  \echo 'runtime roles are absent or have unsafe PostgreSQL attributes'
  \quit 4
\endif

BEGIN;

SELECT pg_catalog.set_config('molit.actor_id', 'service:control-store-bootstrap', true);
SELECT pg_catalog.set_config('molit.trace_id', pg_catalog.md5(:'approval_reference' || pg_catalog.clock_timestamp()::text), true);
SELECT pg_catalog.set_config('molit.correlation_id', :'approval_reference', true);

REVOKE ALL ON SCHEMA molit_control_store FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA molit_control_store FROM :"caas_role", :"dsaas_role";
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA molit_control_store FROM :"caas_role", :"dsaas_role";

GRANT USAGE ON SCHEMA molit_control_store TO :"caas_role", :"dsaas_role";
GRANT SELECT
  ON molit_control_store.schema_migration,
     molit_control_store.control_store_mode
  TO :"caas_role", :"dsaas_role";
GRANT UPDATE (state_root_sha256, updated_at)
  ON molit_control_store.control_store_mode
  TO :"caas_role", :"dsaas_role";
GRANT SELECT, INSERT, UPDATE, DELETE
  ON molit_control_store.control_participant_registry
  TO :"dsaas_role";
GRANT SELECT, INSERT, UPDATE, DELETE
  ON molit_control_store.resource_fence,
     molit_control_store.resource_state,
     molit_control_store.idempotency_record,
     molit_control_store.audit_event,
     molit_control_store.outbox_event,
     molit_control_store.tenant_security_audit,
     molit_control_store.tenant_audit_head,
     molit_control_store.tenant_object_reference,
     molit_control_store.tenant_secret_reference,
     molit_control_store.tenant_metric_sample,
     molit_control_store.usage_meter_event,
     molit_control_store.usage_meter_rollup,
     molit_control_store.usage_meter_reprocess,
     molit_control_store.scoped_control_state,
     molit_control_store.control_scope_registry,
     molit_control_store.component_audit_head
  TO :"caas_role", :"dsaas_role";
REVOKE EXECUTE
  ON FUNCTION molit_control_store.enroll_current_service_principal(text, text)
  FROM :"caas_role", :"dsaas_role";

GRANT EXECUTE
  ON FUNCTION molit_control_store.enroll_scoped_service_principal(text, text),
     FUNCTION molit_control_store.component_principal_active(text),
     FUNCTION molit_control_store.component_tenant_row_visible(text, text),
     FUNCTION molit_control_store.component_platform_row_visible(text)
  TO :"caas_role", :"dsaas_role";

INSERT INTO molit_control_store.control_component_principal
  (database_role, component, active, approved_by, approval_reference)
VALUES
  (:'caas_role', 'caas', true, :'approved_by', :'approval_reference' || '/caas-component'),
  (:'dsaas_role', 'dsaas', true, :'approved_by', :'approval_reference' || '/dsaas-component')
ON CONFLICT (database_role, component) DO UPDATE
SET active = true,
    approved_by = EXCLUDED.approved_by,
    approval_reference = EXCLUDED.approval_reference
WHERE NOT molit_control_store.control_component_principal.active
   OR molit_control_store.control_component_principal.approved_by IS DISTINCT FROM EXCLUDED.approved_by
   OR molit_control_store.control_component_principal.approval_reference IS DISTINCT FROM EXCLUDED.approval_reference;

INSERT INTO molit_control_store.tenant_database_principal
  (database_role, tenant_id, access_mode, active, valid_until, approved_by, approval_reference)
VALUES
  (:'caas_role', 'molit-platform', 'service', true, NULL, :'approved_by', :'approval_reference' || '/caas'),
  (:'dsaas_role', 'molit-platform', 'service', true, NULL, :'approved_by', :'approval_reference' || '/dsaas')
ON CONFLICT (database_role, tenant_id, access_mode) DO UPDATE
SET active = true,
    valid_until = NULL,
    approved_by = EXCLUDED.approved_by,
    approval_reference = EXCLUDED.approval_reference
WHERE NOT molit_control_store.tenant_database_principal.active
   OR molit_control_store.tenant_database_principal.valid_until IS NOT NULL
   OR molit_control_store.tenant_database_principal.approved_by IS DISTINCT FROM EXCLUDED.approved_by
   OR molit_control_store.tenant_database_principal.approval_reference IS DISTINCT FROM EXCLUDED.approval_reference;

INSERT INTO molit_control_store.tenant_database_principal
  (database_role, tenant_id, access_mode, active, valid_until, approved_by, approval_reference)
SELECT CASE registry.component WHEN 'caas' THEN :'caas_role'::name ELSE :'dsaas_role'::name END,
       registry.tenant_id, 'service', true, NULL, :'approved_by',
       :'approval_reference' || '/' || registry.component || '/cutover-scope/' || registry.tenant_id
FROM molit_control_store.control_scope_registry registry
WHERE registry.tenant_id <> 'molit-platform'
ON CONFLICT (database_role, tenant_id, access_mode) DO UPDATE
SET active = true,
    valid_until = NULL,
    approved_by = EXCLUDED.approved_by,
    approval_reference = EXCLUDED.approval_reference;

SELECT count(*) = 2 AS platform_bindings_valid
FROM molit_control_store.tenant_database_principal
WHERE database_role IN (:'caas_role', :'dsaas_role')
  AND tenant_id = 'molit-platform'
  AND access_mode = 'service'
  AND active
  AND valid_until IS NULL
  AND approved_by = :'approved_by'
  AND approval_reference IN (:'approval_reference' || '/caas', :'approval_reference' || '/dsaas')
\gset

\if :platform_bindings_valid
\else
  \echo 'platform service bindings were not established'
  \quit 5
\endif

SELECT count(*) = 2 AS component_bindings_valid
FROM molit_control_store.control_component_principal
WHERE (database_role = :'caas_role' AND component = 'caas'
    OR database_role = :'dsaas_role' AND component = 'dsaas')
  AND active
  AND approved_by = :'approved_by'
  AND approval_reference IN (:'approval_reference' || '/caas-component', :'approval_reference' || '/dsaas-component')
\gset

\if :component_bindings_valid
\else
  \echo 'runtime component bindings were not established'
  \quit 5
\endif

SELECT count(*) = (
  SELECT count(*) FROM molit_control_store.control_scope_registry WHERE tenant_id <> 'molit-platform'
) AS scoped_bindings_valid
FROM molit_control_store.tenant_database_principal binding
WHERE binding.access_mode = 'service' AND binding.active AND binding.valid_until IS NULL
  AND ((binding.database_role = :'caas_role' AND EXISTS (
         SELECT 1 FROM molit_control_store.control_scope_registry registry
         WHERE registry.component = 'caas' AND registry.tenant_id = binding.tenant_id
       ))
    OR (binding.database_role = :'dsaas_role' AND EXISTS (
         SELECT 1 FROM molit_control_store.control_scope_registry registry
         WHERE registry.component = 'dsaas' AND registry.tenant_id = binding.tenant_id
       )))
\gset

\if :scoped_bindings_valid
\else
  \echo 'cutover scope service bindings were not established'
  \quit 5
\endif

COMMIT;

SELECT count(*) = 136 AS required_table_grants
FROM information_schema.role_table_grants
WHERE grantee IN (:'caas_role', :'dsaas_role')
  AND table_schema = 'molit_control_store'
  AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  AND table_name IN (
    'schema_migration', 'control_store_mode', 'resource_fence', 'resource_state', 'idempotency_record', 'audit_event',
    'outbox_event', 'tenant_security_audit', 'tenant_audit_head', 'tenant_object_reference',
    'tenant_secret_reference', 'tenant_metric_sample', 'usage_meter_event', 'usage_meter_rollup',
    'usage_meter_reprocess', 'scoped_control_state', 'control_scope_registry',
    'component_audit_head', 'control_participant_registry'
  )
\gset

\if :required_table_grants
\else
  \echo 'runtime table grants failed verification'
  \quit 6
\endif

SELECT has_column_privilege(:'caas_role', 'molit_control_store.control_store_mode', 'state_root_sha256', 'UPDATE')
  AND has_column_privilege(:'caas_role', 'molit_control_store.control_store_mode', 'updated_at', 'UPDATE')
  AND has_column_privilege(:'dsaas_role', 'molit_control_store.control_store_mode', 'state_root_sha256', 'UPDATE')
  AND has_column_privilege(:'dsaas_role', 'molit_control_store.control_store_mode', 'updated_at', 'UPDATE')
  AND NOT has_column_privilege(:'caas_role', 'molit_control_store.control_store_mode', 'cutover_state_root_sha256', 'UPDATE')
  AND NOT has_column_privilege(:'dsaas_role', 'molit_control_store.control_store_mode', 'cutover_state_root_sha256', 'UPDATE')
  AND NOT has_column_privilege(:'caas_role', 'molit_control_store.control_store_mode', 'source_kind', 'UPDATE')
  AND NOT has_column_privilege(:'dsaas_role', 'molit_control_store.control_store_mode', 'source_kind', 'UPDATE')
  AND NOT has_column_privilege(:'caas_role', 'molit_control_store.control_store_mode', 'source_snapshot_sha256', 'UPDATE')
  AND NOT has_column_privilege(:'dsaas_role', 'molit_control_store.control_store_mode', 'source_snapshot_sha256', 'UPDATE')
  AND NOT has_column_privilege(:'caas_role', 'molit_control_store.control_store_mode', 'cutover_at', 'UPDATE')
  AND NOT has_column_privilege(:'dsaas_role', 'molit_control_store.control_store_mode', 'cutover_at', 'UPDATE')
  AS mode_column_grants_valid
\gset

\if :mode_column_grants_valid
\else
  \echo 'runtime control-store mode column grants failed verification'
  \quit 6
\endif

SELECT NOT has_table_privilege(:'caas_role', 'molit_control_store.json_snapshot', 'SELECT')
  AND NOT has_table_privilege(:'caas_role', 'molit_control_store.json_snapshot', 'INSERT')
  AND NOT has_table_privilege(:'caas_role', 'molit_control_store.json_snapshot', 'UPDATE')
  AND NOT has_table_privilege(:'caas_role', 'molit_control_store.json_snapshot', 'DELETE')
  AND NOT has_table_privilege(:'dsaas_role', 'molit_control_store.json_snapshot', 'SELECT')
  AND NOT has_table_privilege(:'dsaas_role', 'molit_control_store.json_snapshot', 'INSERT')
  AND NOT has_table_privilege(:'dsaas_role', 'molit_control_store.json_snapshot', 'UPDATE')
  AND NOT has_table_privilege(:'dsaas_role', 'molit_control_store.json_snapshot', 'DELETE')
  AS snapshot_runtime_access_revoked
\gset

\if :snapshot_runtime_access_revoked
\else
  \echo 'runtime access to json_snapshot was not revoked'
  \quit 7
\endif

SELECT current_database() AS database_name
\gset
BEGIN;
GRANT CONNECT ON DATABASE :"database_name" TO :"caas_role", :"dsaas_role";
COMMIT;

SELECT count(*) = 2 AS runtime_roles_ready_for_operator_unfence
FROM pg_catalog.pg_roles
WHERE rolname IN (:'caas_role', :'dsaas_role')
  AND NOT rolcanlogin
  AND has_database_privilege(rolname, :'database_name', 'CONNECT')
\gset

\if :runtime_roles_ready_for_operator_unfence
\else
  \echo 'runtime roles are not safely prepared for the operator-controlled LOGIN transition'
  \quit 8
\endif
