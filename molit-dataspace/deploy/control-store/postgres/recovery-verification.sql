\set ON_ERROR_STOP on

SELECT count(*) = 4 AS migrations_valid
FROM molit_control_store.schema_migration
WHERE (component = 'postgres-json-store' AND version = 1)
   OR (component = 'postgres-normalized-projection' AND version = 2)
   OR (component = 'usage-metering' AND version = 3)
   OR (component = 'postgres-scoped-control-store' AND version = 4)
\gset
\if :migrations_valid
\else
  \echo 'required migrations 001 through 004 are incomplete'
  \quit 3
\endif

SELECT count(*) = 10 AS required_tables_valid
FROM unnest(ARRAY[
  'molit_control_store.schema_migration',
  'molit_control_store.resource_state',
  'molit_control_store.audit_event',
  'molit_control_store.outbox_event',
  'molit_control_store.usage_meter_event',
  'molit_control_store.usage_meter_rollup',
  'molit_control_store.scoped_control_state',
  'molit_control_store.control_scope_registry',
  'molit_control_store.component_audit_head',
  'molit_control_store.control_store_mode'
]) AS required(name)
WHERE to_regclass(name) IS NOT NULL
\gset
\if :required_tables_valid
\else
  \echo 'required control-store tables are absent from the recovery cluster'
  \quit 4
\endif

SELECT count(*) = 2 AS cutover_roots_valid
FROM molit_control_store.control_store_mode mode
JOIN molit_control_store.component_audit_head head USING (component)
WHERE mode.mode = 'scoped-authoritative'
  AND mode.source_kind IN ('json-snapshot', 'fresh-install', 'legacy-file-snapshot')
  AND mode.cutover_state_root_sha256 ~ '^[a-f0-9]{64}$'
  AND mode.state_root_sha256 ~ '^[a-f0-9]{64}$'
  AND mode.state_root_sha256 = head.state_root_sha256
  AND mode.cutover_at IS NOT NULL
\gset
\if :cutover_roots_valid
\else
  \echo 'cutover/current roots and component audit heads are inconsistent'
  \quit 5
\endif

SELECT count(*) = 2 AS expected_roots_valid
FROM molit_control_store.control_store_mode
WHERE (component = 'caas' AND state_root_sha256 = :'expected_caas_root')
   OR (component = 'dsaas' AND state_root_sha256 = :'expected_dsaas_root')
\gset
\if :expected_roots_valid
\else
  \echo 'recovered component state roots do not match the approved restore target'
  \quit 5
\endif

SELECT count(*) = 0 AS outbox_states_valid
FROM molit_control_store.outbox_event
WHERE (published_at IS NULL) <> (publish_receipt IS NULL)
   OR (publish_receipt IS NULL) <> (publish_receipt_sha256 IS NULL)
   OR (published_at IS NOT NULL AND dead_lettered_at IS NOT NULL)
   OR (claimed_until IS NOT NULL AND claimed_by IS NULL)
\gset
\if :outbox_states_valid
\else
  \echo 'pending or acknowledged audit outbox rows are inconsistent'
  \quit 6
\endif

SELECT count(*) = 0 AS usage_events_valid
FROM molit_control_store.usage_meter_event
WHERE purpose NOT IN ('operational-non-billable', 'billing-candidate')
   OR quantity <= 0
   OR trace_id !~ '^[a-f0-9]{32}$'
   OR source_event_digest !~ '^[a-f0-9]{64}$'
   OR event_sha256 !~ '^[a-f0-9]{64}$'
\gset
\if :usage_events_valid
\else
  \echo 'usage meter evidence is inconsistent'
  \quit 7
\endif

SELECT json_build_object(
  'migrations', 4,
  'controlStoreModeRows', (SELECT count(*) FROM molit_control_store.control_store_mode),
  'scopedStateRows', (SELECT count(*) FROM molit_control_store.scoped_control_state),
  'outboxPendingRows', (SELECT count(*) FROM molit_control_store.outbox_event WHERE published_at IS NULL AND dead_lettered_at IS NULL),
  'outboxAcknowledgedRows', (SELECT count(*) FROM molit_control_store.outbox_event WHERE published_at IS NOT NULL),
  'usageEventRows', (SELECT count(*) FROM molit_control_store.usage_meter_event)
)::text AS recovery_verification
\gset
\echo :recovery_verification
