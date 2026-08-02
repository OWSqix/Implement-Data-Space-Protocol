BEGIN;

INSERT INTO molit_control_store.schema_migration (component, version, installed_at)
VALUES ('postgres-normalized-projection', 2, clock_timestamp())
ON CONFLICT (component) DO UPDATE
SET version = EXCLUDED.version,
    installed_at = clock_timestamp()
WHERE molit_control_store.schema_migration.version IN (1, EXCLUDED.version);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM molit_control_store.schema_migration
    WHERE component = 'postgres-normalized-projection' AND version = 2
  ) THEN
    RAISE EXCEPTION 'postgres-normalized-projection migration version is incompatible'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS molit_control_store.resource_state (
  component text NOT NULL,
  resource_kind text NOT NULL,
  resource_id text NOT NULL,
  tenant_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  payload jsonb NOT NULL,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (component, tenant_id, resource_kind, resource_id)
);

CREATE TABLE IF NOT EXISTS molit_control_store.idempotency_record (
  component text NOT NULL,
  tenant_id text NOT NULL,
  record_key text NOT NULL,
  payload jsonb NOT NULL,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  snapshot_revision bigint NOT NULL CHECK (snapshot_revision > 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (component, tenant_id, record_key)
);

CREATE TABLE IF NOT EXISTS molit_control_store.audit_event (
  component text NOT NULL,
  tenant_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  event_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  previous_digest text,
  event_digest text NOT NULL CHECK (event_digest ~ '^[a-f0-9]{64}$'),
  event jsonb NOT NULL,
  inserted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (component, sequence),
  UNIQUE (component, event_id)
);

CREATE TABLE IF NOT EXISTS molit_control_store.outbox_event (
  component text NOT NULL,
  event_id text NOT NULL,
  aggregate_kind text NOT NULL,
  aggregate_id text NOT NULL,
  tenant_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL,
  claimed_by text,
  claimed_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  published_at timestamptz,
  publish_receipt jsonb,
  publish_receipt_sha256 text CHECK (publish_receipt_sha256 IS NULL OR publish_receipt_sha256 ~ '^[a-f0-9]{64}$'),
  dead_lettered_at timestamptz,
  last_error_code text,
  PRIMARY KEY (component, event_id),
  CHECK (claimed_until IS NULL OR claimed_by IS NOT NULL),
  CHECK (published_at IS NULL OR dead_lettered_at IS NULL),
  CHECK ((published_at IS NULL) = (publish_receipt IS NULL)),
  CHECK ((publish_receipt IS NULL) = (publish_receipt_sha256 IS NULL))
);

CREATE TABLE IF NOT EXISTS molit_control_store.projection_checkpoint (
  component text PRIMARY KEY,
  snapshot_revision bigint NOT NULL CHECK (snapshot_revision > 0),
  state_sha256 text NOT NULL CHECK (state_sha256 ~ '^[a-f0-9]{64}$'),
  resource_count integer NOT NULL CHECK (resource_count >= 0),
  idempotency_count integer NOT NULL CHECK (idempotency_count >= 0),
  audit_count bigint NOT NULL CHECK (audit_count >= 0),
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS molit_control_store.projection_tenant_registry (
  component text NOT NULL,
  tenant_id text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  PRIMARY KEY (component, tenant_id),
  CHECK (last_seen_at >= first_seen_at)
);

-- Upgrade the unpublished version-1 prototype without inventing a tenant. Rows
-- whose legacy payload cannot identify one are isolated in the platform tenant.
ALTER TABLE molit_control_store.resource_state ADD COLUMN IF NOT EXISTS tenant_id text;
UPDATE molit_control_store.resource_state
SET tenant_id = COALESCE(NULLIF(tenant_id, ''), NULLIF(payload ->> 'tenantId', ''),
  NULLIF(payload #>> '{spec,dataspaceId}', ''), 'molit-platform')
WHERE tenant_id IS NULL OR tenant_id = '';
ALTER TABLE molit_control_store.resource_state ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE molit_control_store.resource_state DROP CONSTRAINT IF EXISTS resource_state_pkey;
ALTER TABLE molit_control_store.resource_state
  ADD CONSTRAINT resource_state_pkey PRIMARY KEY (component, tenant_id, resource_kind, resource_id);

ALTER TABLE molit_control_store.idempotency_record ADD COLUMN IF NOT EXISTS tenant_id text;
UPDATE molit_control_store.idempotency_record
SET tenant_id = COALESCE(NULLIF(tenant_id, ''), NULLIF(payload #>> '{result,tenantId}', ''),
  NULLIF(payload #>> '{result,dataspaceId}', ''), NULLIF(payload #>> '{response,dataspaceId}', ''),
  'molit-platform')
WHERE tenant_id IS NULL OR tenant_id = '';
ALTER TABLE molit_control_store.idempotency_record ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE molit_control_store.idempotency_record DROP CONSTRAINT IF EXISTS idempotency_record_pkey;
ALTER TABLE molit_control_store.idempotency_record
  ADD CONSTRAINT idempotency_record_pkey PRIMARY KEY (component, tenant_id, record_key);

ALTER TABLE molit_control_store.audit_event ADD COLUMN IF NOT EXISTS tenant_id text;
UPDATE molit_control_store.audit_event
SET tenant_id = COALESCE(NULLIF(tenant_id, ''), NULLIF(event ->> 'tenantId', ''),
  NULLIF(substring(event ->> 'resource' FROM '^dataspace:([^/]+)'), ''), 'molit-platform')
WHERE tenant_id IS NULL OR tenant_id = '';
ALTER TABLE molit_control_store.audit_event ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE molit_control_store.outbox_event ADD COLUMN IF NOT EXISTS tenant_id text;
UPDATE molit_control_store.outbox_event
SET tenant_id = COALESCE(NULLIF(tenant_id, ''), 'molit-platform')
WHERE tenant_id IS NULL OR tenant_id = '';
ALTER TABLE molit_control_store.outbox_event ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS resource_state_tenant_idx
ON molit_control_store.resource_state (component, tenant_id, resource_kind, resource_id);

CREATE INDEX IF NOT EXISTS idempotency_record_tenant_idx
ON molit_control_store.idempotency_record (component, tenant_id, updated_at);

CREATE INDEX IF NOT EXISTS audit_event_tenant_idx
ON molit_control_store.audit_event (component, tenant_id, occurred_at, sequence);

DROP INDEX IF EXISTS molit_control_store.outbox_ready_idx;
CREATE INDEX outbox_ready_idx
ON molit_control_store.outbox_event (component, tenant_id, available_at, created_at)
WHERE published_at IS NULL AND dead_lettered_at IS NULL;

CREATE TABLE IF NOT EXISTS molit_control_store.tenant_security_audit (
  component text NOT NULL,
  tenant_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  event_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  actor_id text NOT NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'service', 'workload', 'operator')),
  session_tenant_id text NOT NULL,
  requested_tenant_id text NOT NULL,
  access_mode text NOT NULL CHECK (access_mode IN ('tenant', 'service', 'break-glass')),
  resource_kind text NOT NULL,
  resource_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('PERMIT', 'DENY')),
  reason_code text NOT NULL,
  trace_id text NOT NULL,
  correlation_id text NOT NULL,
  previous_digest text,
  event_digest text NOT NULL CHECK (event_digest ~ '^[a-f0-9]{64}$'),
  event jsonb NOT NULL,
  inserted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (component, tenant_id, sequence),
  UNIQUE (component, event_id)
);

CREATE TABLE IF NOT EXISTS molit_control_store.tenant_audit_head (
  component text NOT NULL,
  tenant_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  event_digest text NOT NULL CHECK (event_digest ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (component, tenant_id)
);

CREATE TABLE IF NOT EXISTS molit_control_store.tenant_object_reference (
  component text NOT NULL,
  tenant_id text NOT NULL,
  object_key text NOT NULL,
  object_sha256 text NOT NULL CHECK (object_sha256 ~ '^[a-f0-9]{64}$'),
  media_type text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (component, tenant_id, object_key),
  CHECK (object_key LIKE ('tenants/' || tenant_id || '/%')),
  CHECK (object_key !~ '(^|/)\.\.(/|$)' AND object_key !~ '//')
);

CREATE TABLE IF NOT EXISTS molit_control_store.tenant_secret_reference (
  component text NOT NULL,
  tenant_id text NOT NULL,
  purpose text NOT NULL,
  secret_ref text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (component, tenant_id, purpose),
  CHECK (
    (secret_ref LIKE ('vault://tenants/' || tenant_id || '/%')
      AND secret_ref !~ '[?#]' AND secret_ref !~ '(^|/)\.\.(/|$)'
      AND substring(secret_ref FROM 9) !~ '//' AND right(secret_ref, 1) <> '/')
    OR
    (secret_ref LIKE ('k8s-secret://molit-caas-' || tenant_id || '/%#%')
      AND secret_ref !~ '[?]' AND secret_ref !~ '(^|/)\.\.(/|$)'
      AND substring(secret_ref FROM 14) !~ '//' AND secret_ref ~ '/[^/#]+#[^/#]+$')
  )
);

CREATE TABLE IF NOT EXISTS molit_control_store.tenant_metric_sample (
  component text NOT NULL,
  tenant_id text NOT NULL,
  metric_name text NOT NULL,
  observed_at timestamptz NOT NULL,
  value double precision NOT NULL,
  labels jsonb NOT NULL,
  PRIMARY KEY (component, tenant_id, metric_name, observed_at),
  CHECK (jsonb_typeof(labels) = 'object'),
  CHECK (labels ->> 'tenant.id' = tenant_id)
);

CREATE TABLE IF NOT EXISTS molit_control_store.tenant_database_principal (
  database_role name NOT NULL,
  tenant_id text NOT NULL,
  access_mode text NOT NULL CHECK (access_mode IN ('tenant', 'service', 'break-glass')),
  active boolean NOT NULL DEFAULT true,
  valid_until timestamptz,
  approved_by text NOT NULL,
  approval_reference text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (database_role, tenant_id, access_mode),
  CHECK (valid_until IS NULL OR valid_until > created_at)
);

REVOKE ALL ON molit_control_store.tenant_database_principal FROM PUBLIC;

CREATE TABLE IF NOT EXISTS molit_control_store.tenant_principal_change_audit (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  database_role name NOT NULL,
  tenant_id text NOT NULL,
  access_mode text NOT NULL,
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  actor_id text NOT NULL,
  trace_id text CHECK (trace_id IS NULL OR trace_id ~ '^[a-f0-9]{32}$'),
  correlation_id text NOT NULL,
  previous_record jsonb,
  current_record jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (previous_record IS NOT NULL OR current_record IS NOT NULL)
);

REVOKE ALL ON molit_control_store.tenant_principal_change_audit FROM PUBLIC;

CREATE OR REPLACE FUNCTION molit_control_store.current_tenant_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('molit.tenant_id', true), '')
$$;

CREATE OR REPLACE FUNCTION molit_control_store.break_glass_active()
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, molit_control_store
AS $$
DECLARE
  expires_at timestamptz;
BEGIN
  IF current_setting('molit.access_mode', true) <> 'break-glass'
     OR length(COALESCE(current_setting('molit.actor_id', true), '')) < 3
     OR length(COALESCE(current_setting('molit.break_glass_reason', true), '')) < 8 THEN
    RETURN false;
  END IF;
  BEGIN
    expires_at := current_setting('molit.break_glass_expires_at', true)::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;
  RETURN expires_at > clock_timestamp()
    AND EXISTS (
      SELECT 1
      FROM molit_control_store.tenant_database_principal binding
      WHERE binding.database_role = session_user
        AND binding.tenant_id = molit_control_store.current_tenant_id()
        AND binding.access_mode = 'break-glass'
        AND binding.active
        AND (binding.valid_until IS NULL OR binding.valid_until > clock_timestamp())
    );
END;
$$;

CREATE OR REPLACE FUNCTION molit_control_store.tenant_principal_active(requested_access_mode text)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, molit_control_store
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM molit_control_store.tenant_database_principal binding
    WHERE binding.database_role = session_user
      AND binding.tenant_id = molit_control_store.current_tenant_id()
      AND binding.access_mode = requested_access_mode
      AND requested_access_mode IN ('tenant', 'service')
      AND binding.active
      AND (binding.valid_until IS NULL OR binding.valid_until > clock_timestamp())
  )
$$;

CREATE OR REPLACE FUNCTION molit_control_store.platform_service_active()
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, molit_control_store
AS $$
  SELECT molit_control_store.current_tenant_id() = 'molit-platform'
    AND current_setting('molit.access_mode', true) = 'service'
    AND EXISTS (
      SELECT 1
      FROM molit_control_store.tenant_database_principal binding
      WHERE binding.database_role = session_user
        AND binding.tenant_id = 'molit-platform'
        AND binding.access_mode = 'service'
        AND binding.active
        AND (binding.valid_until IS NULL OR binding.valid_until > clock_timestamp())
    )
$$;

CREATE OR REPLACE FUNCTION molit_control_store.enroll_current_service_principal(
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
    RAISE EXCEPTION 'target tenant identifier is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF target_component NOT IN ('caas', 'dsaas') THEN
    RAISE EXCEPTION 'target component is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO caller_role FROM pg_catalog.pg_roles WHERE rolname = session_user;
  IF NOT FOUND OR NOT caller_role.rolcanlogin OR caller_role.rolsuper
     OR caller_role.rolcreaterole OR caller_role.rolcreatedb OR caller_role.rolbypassrls THEN
    RAISE EXCEPTION 'caller database role is not an eligible control-plane runtime role'
      USING ERRCODE = '42501';
  END IF;
  IF NOT molit_control_store.platform_service_active() THEN
    RAISE EXCEPTION 'active molit-platform service binding is required'
      USING ERRCODE = '42501';
  END IF;

  expected_actor_id := 'service:' || target_component || '-normalized-projection';
  IF current_setting('molit.actor_id', true) IS DISTINCT FROM expected_actor_id THEN
    RAISE EXCEPTION 'control-plane projection actor is required'
      USING ERRCODE = '42501';
  END IF;
  IF COALESCE(current_setting('molit.trace_id', true), '') !~ '^[a-f0-9]{32}$'
     OR length(COALESCE(current_setting('molit.correlation_id', true), '')) < 8 THEN
    RAISE EXCEPTION 'trace and correlation context is required'
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
    RAISE EXCEPTION 'platform service delegation is missing or expired'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO molit_control_store.tenant_database_principal
    (database_role, tenant_id, access_mode, active, valid_until, approved_by, approval_reference)
  VALUES
    (session_user, target_tenant_id, 'service', true, platform_binding.valid_until,
     expected_actor_id, platform_binding.approval_reference || '/tenant-enrollment')
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
    RAISE EXCEPTION 'target tenant service binding is inactive or expired'
      USING ERRCODE = '42501';
  END IF;
  RETURN inserted_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION molit_control_store.enroll_current_service_principal(text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION molit_control_store.tenant_row_visible(row_tenant_id text)
RETURNS boolean
LANGUAGE sql
VOLATILE
AS $$
  SELECT (
      row_tenant_id = molit_control_store.current_tenant_id()
      AND molit_control_store.tenant_principal_active(current_setting('molit.access_mode', true))
    ) OR molit_control_store.break_glass_active()
$$;

ALTER TABLE molit_control_store.resource_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE molit_control_store.resource_state FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON molit_control_store.resource_state;
CREATE POLICY tenant_isolation ON molit_control_store.resource_state
  USING (molit_control_store.tenant_row_visible(tenant_id))
  WITH CHECK (molit_control_store.tenant_row_visible(tenant_id));

ALTER TABLE molit_control_store.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE molit_control_store.idempotency_record FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON molit_control_store.idempotency_record;
CREATE POLICY tenant_isolation ON molit_control_store.idempotency_record
  USING (molit_control_store.tenant_row_visible(tenant_id))
  WITH CHECK (molit_control_store.tenant_row_visible(tenant_id));

ALTER TABLE molit_control_store.audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE molit_control_store.audit_event FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON molit_control_store.audit_event;
CREATE POLICY tenant_isolation ON molit_control_store.audit_event
  USING (molit_control_store.tenant_row_visible(tenant_id))
  WITH CHECK (molit_control_store.tenant_row_visible(tenant_id));

ALTER TABLE molit_control_store.outbox_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE molit_control_store.outbox_event FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON molit_control_store.outbox_event;
CREATE POLICY tenant_isolation ON molit_control_store.outbox_event
  USING (molit_control_store.tenant_row_visible(tenant_id))
  WITH CHECK (molit_control_store.tenant_row_visible(tenant_id));

ALTER TABLE molit_control_store.tenant_security_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE molit_control_store.tenant_security_audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON molit_control_store.tenant_security_audit;
CREATE POLICY tenant_isolation ON molit_control_store.tenant_security_audit
  USING (molit_control_store.tenant_row_visible(tenant_id))
  WITH CHECK (molit_control_store.tenant_row_visible(tenant_id));

ALTER TABLE molit_control_store.tenant_audit_head ENABLE ROW LEVEL SECURITY;
ALTER TABLE molit_control_store.tenant_audit_head FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON molit_control_store.tenant_audit_head;
CREATE POLICY tenant_isolation ON molit_control_store.tenant_audit_head
  USING (molit_control_store.tenant_row_visible(tenant_id))
  WITH CHECK (molit_control_store.tenant_row_visible(tenant_id));

ALTER TABLE molit_control_store.tenant_object_reference ENABLE ROW LEVEL SECURITY;
ALTER TABLE molit_control_store.tenant_object_reference FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON molit_control_store.tenant_object_reference;
CREATE POLICY tenant_isolation ON molit_control_store.tenant_object_reference
  USING (molit_control_store.tenant_row_visible(tenant_id))
  WITH CHECK (molit_control_store.tenant_row_visible(tenant_id));

ALTER TABLE molit_control_store.tenant_secret_reference ENABLE ROW LEVEL SECURITY;
ALTER TABLE molit_control_store.tenant_secret_reference FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON molit_control_store.tenant_secret_reference;
CREATE POLICY tenant_isolation ON molit_control_store.tenant_secret_reference
  USING (molit_control_store.tenant_row_visible(tenant_id))
  WITH CHECK (molit_control_store.tenant_row_visible(tenant_id));

ALTER TABLE molit_control_store.tenant_metric_sample ENABLE ROW LEVEL SECURITY;
ALTER TABLE molit_control_store.tenant_metric_sample FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON molit_control_store.tenant_metric_sample;
CREATE POLICY tenant_isolation ON molit_control_store.tenant_metric_sample
  USING (molit_control_store.tenant_row_visible(tenant_id))
  WITH CHECK (molit_control_store.tenant_row_visible(tenant_id));

ALTER TABLE molit_control_store.json_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE molit_control_store.json_snapshot FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_service_only ON molit_control_store.json_snapshot;
CREATE POLICY platform_service_only ON molit_control_store.json_snapshot
  USING (molit_control_store.platform_service_active())
  WITH CHECK (molit_control_store.platform_service_active());

ALTER TABLE molit_control_store.resource_fence ENABLE ROW LEVEL SECURITY;
ALTER TABLE molit_control_store.resource_fence FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_service_only ON molit_control_store.resource_fence;
CREATE POLICY platform_service_only ON molit_control_store.resource_fence
  USING (molit_control_store.platform_service_active())
  WITH CHECK (molit_control_store.platform_service_active());

ALTER TABLE molit_control_store.projection_checkpoint ENABLE ROW LEVEL SECURITY;
ALTER TABLE molit_control_store.projection_checkpoint FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_service_only ON molit_control_store.projection_checkpoint;
CREATE POLICY platform_service_only ON molit_control_store.projection_checkpoint
  USING (molit_control_store.platform_service_active())
  WITH CHECK (molit_control_store.platform_service_active());

ALTER TABLE molit_control_store.projection_tenant_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE molit_control_store.projection_tenant_registry FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_service_only ON molit_control_store.projection_tenant_registry;
CREATE POLICY platform_service_only ON molit_control_store.projection_tenant_registry
  USING (molit_control_store.platform_service_active())
  WITH CHECK (molit_control_store.platform_service_active());

CREATE OR REPLACE FUNCTION molit_control_store.reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION molit_control_store.audit_tenant_principal_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, molit_control_store
AS $$
DECLARE
  old_record jsonb;
  new_record jsonb;
  changed_role name;
  changed_tenant text;
  changed_mode text;
  audit_trace_id text;
BEGIN
  old_record := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END;
  new_record := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END;
  changed_role := CASE WHEN TG_OP = 'DELETE' THEN OLD.database_role ELSE NEW.database_role END;
  changed_tenant := CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
  changed_mode := CASE WHEN TG_OP = 'DELETE' THEN OLD.access_mode ELSE NEW.access_mode END;
  audit_trace_id := NULLIF(current_setting('molit.trace_id', true), '');
  IF audit_trace_id IS NOT NULL AND audit_trace_id !~ '^[a-f0-9]{32}$' THEN
    audit_trace_id := NULL;
  END IF;

  INSERT INTO molit_control_store.tenant_principal_change_audit
    (database_role, tenant_id, access_mode, action, actor_id, trace_id,
     correlation_id, previous_record, current_record, occurred_at)
  VALUES
    (changed_role, changed_tenant, changed_mode, TG_OP,
     COALESCE(NULLIF(current_setting('molit.actor_id', true), ''), 'database-role:' || session_user),
     audit_trace_id,
     COALESCE(NULLIF(current_setting('molit.correlation_id', true), ''), 'database-principal-change'),
     old_record, new_record, clock_timestamp());
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tenant_database_principal_change_audit ON molit_control_store.tenant_database_principal;
CREATE TRIGGER tenant_database_principal_change_audit
AFTER INSERT OR UPDATE OR DELETE ON molit_control_store.tenant_database_principal
FOR EACH ROW EXECUTE FUNCTION molit_control_store.audit_tenant_principal_change();

DROP TRIGGER IF EXISTS audit_event_append_only ON molit_control_store.audit_event;
CREATE TRIGGER audit_event_append_only
BEFORE UPDATE OR DELETE ON molit_control_store.audit_event
FOR EACH ROW EXECUTE FUNCTION molit_control_store.reject_audit_mutation();

DROP TRIGGER IF EXISTS tenant_security_audit_append_only ON molit_control_store.tenant_security_audit;
CREATE TRIGGER tenant_security_audit_append_only
BEFORE UPDATE OR DELETE ON molit_control_store.tenant_security_audit
FOR EACH ROW EXECUTE FUNCTION molit_control_store.reject_audit_mutation();

DROP TRIGGER IF EXISTS tenant_principal_change_audit_append_only ON molit_control_store.tenant_principal_change_audit;
CREATE TRIGGER tenant_principal_change_audit_append_only
BEFORE UPDATE OR DELETE ON molit_control_store.tenant_principal_change_audit
FOR EACH ROW EXECUTE FUNCTION molit_control_store.reject_audit_mutation();

COMMIT;
