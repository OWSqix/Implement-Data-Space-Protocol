BEGIN;

CREATE SCHEMA IF NOT EXISTS molit_control_store;

CREATE TABLE IF NOT EXISTS molit_control_store.schema_migration (
  component text PRIMARY KEY,
  version integer NOT NULL CHECK (version > 0),
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO molit_control_store.schema_migration (component, version)
VALUES ('postgres-json-store', 1)
ON CONFLICT (component) DO UPDATE
SET version = EXCLUDED.version,
    installed_at = clock_timestamp()
WHERE molit_control_store.schema_migration.version = EXCLUDED.version;

CREATE TABLE IF NOT EXISTS molit_control_store.json_snapshot (
  component text PRIMARY KEY,
  revision bigint NOT NULL CHECK (revision > 0),
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS molit_control_store.resource_fence (
  component text NOT NULL,
  resource_id text NOT NULL,
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  holder_id text NOT NULL,
  acquired_at timestamptz NOT NULL,
  released_at timestamptz,
  PRIMARY KEY (component, resource_id),
  CHECK (released_at IS NULL OR released_at >= acquired_at)
);

COMMIT;
