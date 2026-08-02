BEGIN;

INSERT INTO molit_control_store.schema_migration (component, version, installed_at)
VALUES ('postgres-scoped-control-store', 4, clock_timestamp())
ON CONFLICT (component) DO UPDATE
SET version = EXCLUDED.version,
    installed_at = clock_timestamp()
WHERE molit_control_store.schema_migration.version = EXCLUDED.version;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM molit_control_store.schema_migration
    WHERE component = 'postgres-scoped-control-store' AND version = 4
  ) THEN
    RAISE EXCEPTION 'scoped control-store migration version is incompatible'
      USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('molit_control_store.tenant_row_visible(text)') IS NULL THEN
    RAISE EXCEPTION 'tenant isolation migration version 2 is required'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS molit_control_store.control_component_principal (
  database_role name NOT NULL,
  component text NOT NULL CHECK (component IN ('caas', 'dsaas')),
  active boolean NOT NULL DEFAULT true,
  approved_by text NOT NULL,
  approval_reference text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (database_role, component)
);

REVOKE ALL ON molit_control_store.control_component_principal FROM PUBLIC;

CREATE OR REPLACE FUNCTION molit_control_store.component_principal_active(requested_component text)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, molit_control_store
AS $$
  SELECT requested_component IN ('caas', 'dsaas')
    AND EXISTS (
      SELECT 1
      FROM molit_control_store.control_component_principal binding
      WHERE binding.database_role = session_user
        AND binding.component = requested_component
        AND binding.active
    )
$$;

CREATE OR REPLACE FUNCTION molit_control_store.component_tenant_row_visible(
  row_component text,
  row_tenant_id text
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, molit_control_store
AS $$
  SELECT molit_control_store.component_principal_active(row_component)
    AND molit_control_store.tenant_row_visible(row_tenant_id)
$$;

CREATE OR REPLACE FUNCTION molit_control_store.component_platform_row_visible(row_component text)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, molit_control_store
AS $$
  SELECT molit_control_store.component_principal_active(row_component)
    AND molit_control_store.platform_service_active()
$$;

CREATE TABLE IF NOT EXISTS molit_control_store.scoped_control_state (
  component text NOT NULL CHECK (component IN ('caas', 'dsaas')),
  tenant_id text NOT NULL,
  resource_kind text NOT NULL CHECK (resource_kind IN ('tenant', 'dataspace')),
  revision bigint NOT NULL CHECK (revision > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (component, tenant_id),
  CHECK ((component = 'caas' AND resource_kind = 'tenant')
    OR (component = 'dsaas' AND resource_kind = 'dataspace'))
);

CREATE TABLE IF NOT EXISTS molit_control_store.control_scope_registry (
  component text NOT NULL CHECK (component IN ('caas', 'dsaas')),
  tenant_id text NOT NULL,
  resource_kind text NOT NULL CHECK (resource_kind IN ('platform', 'tenant', 'dataspace')),
  participant_id text,
  connector_namespace text,
  endpoint text,
  state_revision bigint NOT NULL CHECK (state_revision >= 0),
  state_sha256 text NOT NULL CHECK (state_sha256 ~ '^[a-f0-9]{64}$'),
  idempotency_count integer NOT NULL DEFAULT 0 CHECK (idempotency_count >= 0),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  PRIMARY KEY (component, tenant_id),
  CHECK (last_seen_at >= first_seen_at),
  CHECK ((tenant_id = 'molit-platform' AND resource_kind = 'platform' AND state_revision = 0)
    OR (tenant_id <> 'molit-platform' AND resource_kind <> 'platform' AND state_revision > 0))
);

CREATE UNIQUE INDEX IF NOT EXISTS control_scope_participant_unique
ON molit_control_store.control_scope_registry (component, participant_id)
WHERE participant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS control_scope_namespace_unique
ON molit_control_store.control_scope_registry (component, connector_namespace)
WHERE connector_namespace IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS control_scope_endpoint_unique
ON molit_control_store.control_scope_registry (component, endpoint)
WHERE endpoint IS NOT NULL;

CREATE TABLE IF NOT EXISTS molit_control_store.control_participant_registry (
  component text NOT NULL CHECK (component = 'dsaas'),
  dataspace_id text NOT NULL CHECK (dataspace_id ~ '^[a-z][a-z0-9-]{2,62}$'),
  participant_id text NOT NULL CHECK (participant_id ~ '^[a-z][a-z0-9-]{2,62}$'),
  caas_tenant_id text NOT NULL CHECK (caas_tenant_id ~ '^[a-z][a-z0-9-]{2,62}$'),
  connector_participant_id text NOT NULL CHECK (length(connector_participant_id) BETWEEN 3 AND 1024),
  connector_namespace text NOT NULL CHECK (length(connector_namespace) BETWEEN 8 AND 2048),
  participant_sha256 text NOT NULL CHECK (participant_sha256 ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (component, dataspace_id, participant_id),
  UNIQUE (component, caas_tenant_id),
  UNIQUE (component, connector_participant_id),
  UNIQUE (component, connector_namespace)
);

CREATE TABLE IF NOT EXISTS molit_control_store.component_audit_head (
  component text PRIMARY KEY CHECK (component IN ('caas', 'dsaas')),
  sequence bigint NOT NULL CHECK (sequence >= 0),
  event_digest text NOT NULL CHECK (event_digest ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz,
  state_root_sha256 text NOT NULL CHECK (state_root_sha256 ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz NOT NULL,
  CHECK ((sequence = 0 AND occurred_at IS NULL AND event_digest = repeat('0', 64))
    OR (sequence > 0 AND occurred_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS molit_control_store.control_store_mode (
  component text PRIMARY KEY CHECK (component IN ('caas', 'dsaas')),
  mode text NOT NULL CHECK (mode IN ('projection', 'scoped-authoritative')),
  source_kind text CHECK (source_kind IS NULL OR source_kind IN ('json-snapshot', 'fresh-install', 'legacy-file-snapshot')),
  source_snapshot_revision bigint CHECK (source_snapshot_revision IS NULL OR source_snapshot_revision > 0),
  source_snapshot_sha256 text CHECK (source_snapshot_sha256 IS NULL OR source_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  source_approval_evidence_sha256 text CHECK (source_approval_evidence_sha256 IS NULL OR source_approval_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  scope_map_sha256 text CHECK (scope_map_sha256 IS NULL OR scope_map_sha256 ~ '^[a-f0-9]{64}$'),
  scope_map_approval_evidence_sha256 text CHECK (scope_map_approval_evidence_sha256 IS NULL OR scope_map_approval_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  legacy_key_conversion_count integer NOT NULL DEFAULT 0 CHECK (legacy_key_conversion_count >= 0),
  cutover_state_root_sha256 text CHECK (cutover_state_root_sha256 IS NULL OR cutover_state_root_sha256 ~ '^[a-f0-9]{64}$'),
  state_root_sha256 text CHECK (state_root_sha256 IS NULL OR state_root_sha256 ~ '^[a-f0-9]{64}$'),
  cutover_at timestamptz,
  updated_at timestamptz NOT NULL,
  CONSTRAINT control_store_mode_cutover_root_check CHECK (
    (mode = 'projection' AND source_kind IS NULL AND cutover_state_root_sha256 IS NULL AND cutover_at IS NULL)
    OR (mode = 'scoped-authoritative' AND source_snapshot_revision IS NOT NULL
      AND source_kind IS NOT NULL AND source_snapshot_sha256 IS NOT NULL
      AND cutover_state_root_sha256 IS NOT NULL AND state_root_sha256 IS NOT NULL AND cutover_at IS NOT NULL))
);

ALTER TABLE molit_control_store.control_store_mode
  ADD COLUMN IF NOT EXISTS cutover_state_root_sha256 text
  CHECK (cutover_state_root_sha256 IS NULL OR cutover_state_root_sha256 ~ '^[a-f0-9]{64}$');

ALTER TABLE molit_control_store.control_store_mode
  DROP CONSTRAINT IF EXISTS control_store_mode_cutover_root_check;
ALTER TABLE molit_control_store.control_store_mode
  ADD CONSTRAINT control_store_mode_cutover_root_check CHECK (
    (mode = 'projection' AND source_kind IS NULL AND cutover_state_root_sha256 IS NULL AND cutover_at IS NULL)
    OR (mode = 'scoped-authoritative' AND source_snapshot_revision IS NOT NULL
      AND source_kind IS NOT NULL AND source_snapshot_sha256 IS NOT NULL
      AND cutover_state_root_sha256 IS NOT NULL AND state_root_sha256 IS NOT NULL AND cutover_at IS NOT NULL)
  );

INSERT INTO molit_control_store.control_store_mode (component, mode, updated_at)
VALUES
  ('caas', 'projection', clock_timestamp()),
  ('dsaas', 'projection', clock_timestamp())
ON CONFLICT (component) DO NOTHING;

ALTER TABLE molit_control_store.scoped_control_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE molit_control_store.scoped_control_state FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS component_tenant_isolation ON molit_control_store.scoped_control_state;
CREATE POLICY component_tenant_isolation ON molit_control_store.scoped_control_state
  USING (molit_control_store.component_tenant_row_visible(component, tenant_id))
  WITH CHECK (molit_control_store.component_tenant_row_visible(component, tenant_id));

ALTER TABLE molit_control_store.control_scope_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE molit_control_store.control_scope_registry FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS component_platform_only ON molit_control_store.control_scope_registry;
CREATE POLICY component_platform_only ON molit_control_store.control_scope_registry
  USING (molit_control_store.component_platform_row_visible(component))
  WITH CHECK (molit_control_store.component_platform_row_visible(component));

ALTER TABLE molit_control_store.component_audit_head ENABLE ROW LEVEL SECURITY;
ALTER TABLE molit_control_store.component_audit_head FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS component_platform_only ON molit_control_store.component_audit_head;
CREATE POLICY component_platform_only ON molit_control_store.component_audit_head
  USING (molit_control_store.component_platform_row_visible(component))
  WITH CHECK (molit_control_store.component_platform_row_visible(component));

ALTER TABLE molit_control_store.control_participant_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE molit_control_store.control_participant_registry FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS component_platform_only ON molit_control_store.control_participant_registry;
CREATE POLICY component_platform_only ON molit_control_store.control_participant_registry
  USING (molit_control_store.component_platform_row_visible(component))
  WITH CHECK (molit_control_store.component_platform_row_visible(component));

ALTER TABLE molit_control_store.control_store_mode ENABLE ROW LEVEL SECURITY;
ALTER TABLE molit_control_store.control_store_mode FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS component_platform_only ON molit_control_store.control_store_mode;
CREATE POLICY component_platform_only ON molit_control_store.control_store_mode
  USING (molit_control_store.component_platform_row_visible(component))
  WITH CHECK (molit_control_store.component_platform_row_visible(component));

CREATE OR REPLACE FUNCTION molit_control_store.enroll_scoped_service_principal(
  target_tenant_id text,
  target_component text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, molit_control_store
AS $$
DECLARE
  caller_role pg_catalog.pg_roles%ROWTYPE;
  platform_binding molit_control_store.tenant_database_principal%ROWTYPE;
  inserted_count integer := 0;
  expected_actor_id text;
BEGIN
  IF target_tenant_id IS NULL
     OR target_tenant_id = 'molit-platform'
     OR target_tenant_id !~ '^[a-z][a-z0-9-]{2,62}$' THEN
    RAISE EXCEPTION 'target tenant identifier is invalid' USING ERRCODE = '22023';
  END IF;
  IF target_component NOT IN ('caas', 'dsaas')
     OR NOT molit_control_store.component_principal_active(target_component) THEN
    RAISE EXCEPTION 'active component binding is required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM molit_control_store.control_store_mode mode
    WHERE mode.component = target_component AND mode.mode = 'scoped-authoritative'
  ) THEN
    RAISE EXCEPTION 'scoped-authoritative cutover is required' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO caller_role FROM pg_catalog.pg_roles WHERE rolname = session_user;
  IF NOT FOUND OR NOT caller_role.rolcanlogin OR caller_role.rolsuper
     OR caller_role.rolcreaterole OR caller_role.rolcreatedb OR caller_role.rolbypassrls THEN
    RAISE EXCEPTION 'caller database role is not an eligible control-plane runtime role'
      USING ERRCODE = '42501';
  END IF;
  IF NOT molit_control_store.platform_service_active() THEN
    RAISE EXCEPTION 'active molit-platform service binding is required' USING ERRCODE = '42501';
  END IF;

  expected_actor_id := 'service:' || target_component || '-scoped-store';
  IF current_setting('molit.actor_id', true) IS DISTINCT FROM expected_actor_id
     OR COALESCE(current_setting('molit.trace_id', true), '') !~ '^[a-f0-9]{32}$'
     OR length(COALESCE(current_setting('molit.correlation_id', true), '')) < 8 THEN
    RAISE EXCEPTION 'scoped store actor, trace, and correlation context are required'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO platform_binding
  FROM molit_control_store.tenant_database_principal binding
  WHERE binding.database_role = session_user
    AND binding.tenant_id = 'molit-platform'
    AND binding.access_mode = 'service'
    AND binding.active
    AND (binding.valid_until IS NULL OR binding.valid_until > clock_timestamp());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform service delegation is missing or expired' USING ERRCODE = '42501';
  END IF;

  INSERT INTO molit_control_store.tenant_database_principal
    (database_role, tenant_id, access_mode, active, valid_until, approved_by, approval_reference)
  VALUES
    (session_user, target_tenant_id, 'service', true, platform_binding.valid_until,
     expected_actor_id, platform_binding.approval_reference || '/scoped-enrollment')
  ON CONFLICT (database_role, tenant_id, access_mode) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  IF NOT EXISTS (
    SELECT 1 FROM molit_control_store.tenant_database_principal binding
    WHERE binding.database_role = session_user
      AND binding.tenant_id = target_tenant_id
      AND binding.access_mode = 'service'
      AND binding.active
      AND (binding.valid_until IS NULL OR binding.valid_until > clock_timestamp())
  ) THEN
    RAISE EXCEPTION 'target tenant service binding is inactive or expired' USING ERRCODE = '42501';
  END IF;
  RETURN inserted_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION molit_control_store.enroll_scoped_service_principal(text, text) FROM PUBLIC;

-- Replace tenant-only policies with component-and-tenant policies. This prevents
-- the CaaS login from changing its session component and reading DSaaS rows.
DO $policy$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'resource_state', 'idempotency_record', 'audit_event', 'outbox_event',
    'tenant_security_audit', 'tenant_audit_head', 'tenant_object_reference',
    'tenant_secret_reference', 'tenant_metric_sample', 'usage_meter_event',
    'usage_meter_rollup', 'usage_meter_reprocess'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON molit_control_store.%I', target_table);
    EXECUTE format('DROP POLICY IF EXISTS component_tenant_isolation ON molit_control_store.%I', target_table);
    EXECUTE format(
      'CREATE POLICY component_tenant_isolation ON molit_control_store.%I USING (molit_control_store.component_tenant_row_visible(component, tenant_id)) WITH CHECK (molit_control_store.component_tenant_row_visible(component, tenant_id))',
      target_table
    );
  END LOOP;
END;
$policy$;

DO $policy$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'json_snapshot', 'resource_fence', 'projection_checkpoint',
    'projection_tenant_registry'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS platform_service_only ON molit_control_store.%I', target_table);
    EXECUTE format('DROP POLICY IF EXISTS component_platform_only ON molit_control_store.%I', target_table);
    EXECUTE format(
      'CREATE POLICY component_platform_only ON molit_control_store.%I USING (molit_control_store.component_platform_row_visible(component)) WITH CHECK (molit_control_store.component_platform_row_visible(component))',
      target_table
    );
  END LOOP;
END;
$policy$;

REVOKE ALL ON molit_control_store.scoped_control_state FROM PUBLIC;
REVOKE ALL ON molit_control_store.control_scope_registry FROM PUBLIC;
REVOKE ALL ON molit_control_store.control_participant_registry FROM PUBLIC;
REVOKE ALL ON molit_control_store.component_audit_head FROM PUBLIC;
REVOKE ALL ON molit_control_store.control_store_mode FROM PUBLIC;
REVOKE ALL ON FUNCTION molit_control_store.component_principal_active(text) FROM PUBLIC;

COMMIT;
