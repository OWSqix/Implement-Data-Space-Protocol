BEGIN;

INSERT INTO molit_control_store.schema_migration (component, version, installed_at)
VALUES ('usage-metering', 3, clock_timestamp())
ON CONFLICT (component) DO UPDATE
SET version = EXCLUDED.version,
    installed_at = clock_timestamp()
WHERE molit_control_store.schema_migration.version = EXCLUDED.version;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM molit_control_store.schema_migration
    WHERE component = 'usage-metering' AND version = 3
  ) THEN
    RAISE EXCEPTION 'usage-metering migration version is incompatible'
      USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('molit_control_store.tenant_row_visible(text)') IS NULL THEN
    RAISE EXCEPTION 'tenant isolation migration version 2 is required'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS molit_control_store.usage_meter_event (
  component text NOT NULL,
  tenant_id text NOT NULL,
  event_id text NOT NULL,
  meter_name text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('operational-non-billable', 'billing-candidate')),
  quantity numeric(30,9) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL,
  occurred_at timestamptz NOT NULL,
  trace_id text NOT NULL CHECK (trace_id ~ '^[a-f0-9]{32}$'),
  correlation_id text NOT NULL,
  source_event_id text NOT NULL,
  source_event_digest text NOT NULL CHECK (source_event_digest ~ '^[a-f0-9]{64}$'),
  dimensions jsonb NOT NULL CHECK (jsonb_typeof(dimensions) = 'object'),
  dimensions_sha256 text NOT NULL CHECK (dimensions_sha256 ~ '^[a-f0-9]{64}$'),
  event jsonb NOT NULL CHECK (jsonb_typeof(event) = 'object'),
  event_sha256 text NOT NULL CHECK (event_sha256 ~ '^[a-f0-9]{64}$'),
  ingested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (component, tenant_id, event_id),
  UNIQUE (component, tenant_id, source_event_id)
);

ALTER TABLE molit_control_store.usage_meter_event
  ADD COLUMN IF NOT EXISTS purpose text;
UPDATE molit_control_store.usage_meter_event
SET purpose = 'operational-non-billable'
WHERE purpose IS NULL;
ALTER TABLE molit_control_store.usage_meter_event
  ALTER COLUMN purpose SET NOT NULL;
ALTER TABLE molit_control_store.usage_meter_event
  DROP CONSTRAINT IF EXISTS usage_meter_event_purpose_check;
ALTER TABLE molit_control_store.usage_meter_event
  ADD CONSTRAINT usage_meter_event_purpose_check
  CHECK (purpose IN ('operational-non-billable', 'billing-candidate'));

CREATE INDEX IF NOT EXISTS usage_meter_event_rollup_idx
ON molit_control_store.usage_meter_event
  (component, tenant_id, meter_name, occurred_at, dimensions_sha256);

CREATE TABLE IF NOT EXISTS molit_control_store.usage_meter_rollup (
  component text NOT NULL,
  tenant_id text NOT NULL,
  meter_name text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('operational-non-billable', 'billing-candidate')),
  unit text NOT NULL,
  period_start timestamptz NOT NULL,
  period_seconds integer NOT NULL CHECK (period_seconds = 3600),
  dimensions jsonb NOT NULL CHECK (jsonb_typeof(dimensions) = 'object'),
  dimensions_sha256 text NOT NULL CHECK (dimensions_sha256 ~ '^[a-f0-9]{64}$'),
  quantity numeric(38,9) NOT NULL CHECK (quantity >= 0),
  event_count bigint NOT NULL CHECK (event_count >= 0),
  rebuilt_at timestamptz NOT NULL,
  PRIMARY KEY (component, tenant_id, meter_name, unit, period_start, dimensions_sha256)
);

ALTER TABLE molit_control_store.usage_meter_rollup
  ADD COLUMN IF NOT EXISTS purpose text;
UPDATE molit_control_store.usage_meter_rollup
SET purpose = 'operational-non-billable'
WHERE purpose IS NULL;
ALTER TABLE molit_control_store.usage_meter_rollup
  ALTER COLUMN purpose SET NOT NULL;
ALTER TABLE molit_control_store.usage_meter_rollup
  DROP CONSTRAINT IF EXISTS usage_meter_rollup_purpose_check;
ALTER TABLE molit_control_store.usage_meter_rollup
  ADD CONSTRAINT usage_meter_rollup_purpose_check
  CHECK (purpose IN ('operational-non-billable', 'billing-candidate'));

CREATE TABLE IF NOT EXISTS molit_control_store.usage_meter_reprocess (
  component text NOT NULL,
  tenant_id text NOT NULL,
  operation_id text NOT NULL,
  meter_name text NOT NULL,
  period_from timestamptz NOT NULL,
  period_to timestamptz NOT NULL,
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  completed_at timestamptz NOT NULL,
  PRIMARY KEY (component, tenant_id, operation_id),
  CHECK (period_to > period_from)
);

CREATE OR REPLACE FUNCTION molit_control_store.reject_usage_meter_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS usage_meter_event_append_only ON molit_control_store.usage_meter_event;
CREATE TRIGGER usage_meter_event_append_only
BEFORE UPDATE OR DELETE ON molit_control_store.usage_meter_event
FOR EACH ROW EXECUTE FUNCTION molit_control_store.reject_usage_meter_mutation();

DROP TRIGGER IF EXISTS usage_meter_reprocess_append_only ON molit_control_store.usage_meter_reprocess;
CREATE TRIGGER usage_meter_reprocess_append_only
BEFORE UPDATE OR DELETE ON molit_control_store.usage_meter_reprocess
FOR EACH ROW EXECUTE FUNCTION molit_control_store.reject_usage_meter_mutation();

ALTER TABLE molit_control_store.usage_meter_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE molit_control_store.usage_meter_event FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON molit_control_store.usage_meter_event;
CREATE POLICY tenant_isolation ON molit_control_store.usage_meter_event
  USING (molit_control_store.tenant_row_visible(tenant_id))
  WITH CHECK (molit_control_store.tenant_row_visible(tenant_id));

ALTER TABLE molit_control_store.usage_meter_rollup ENABLE ROW LEVEL SECURITY;
ALTER TABLE molit_control_store.usage_meter_rollup FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON molit_control_store.usage_meter_rollup;
CREATE POLICY tenant_isolation ON molit_control_store.usage_meter_rollup
  USING (molit_control_store.tenant_row_visible(tenant_id))
  WITH CHECK (molit_control_store.tenant_row_visible(tenant_id));

ALTER TABLE molit_control_store.usage_meter_reprocess ENABLE ROW LEVEL SECURITY;
ALTER TABLE molit_control_store.usage_meter_reprocess FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON molit_control_store.usage_meter_reprocess;
CREATE POLICY tenant_isolation ON molit_control_store.usage_meter_reprocess
  USING (molit_control_store.tenant_row_visible(tenant_id))
  WITH CHECK (molit_control_store.tenant_row_visible(tenant_id));

COMMIT;
