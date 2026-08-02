#!/bin/sh
set -eu

fail() {
  printf '%s\n' "$1" >&2
  exit 2
}

[ "${1:-}" = "migrate-and-verify" ] || fail "usage: migrate-and-verify"
[ "${MOLIT_EDC_SCHEMA_COMPONENT:-}" = "control-plane" ] || [ "${MOLIT_EDC_SCHEMA_COMPONENT:-}" = "data-plane" ] || fail "invalid schema component"
[ "${MOLIT_EDC_DATABASE_TLS_MODE:-}" = "verify-full" ] || fail "database TLS mode must be verify-full"
[ "${MOLIT_EDC_REQUIRED_SCHEMA_VERSION:-}" = "edc-0.18.0-sql-v1" ] || fail "required schema version is not supported by this artifact"
case "${MOLIT_EDC_MIGRATION_ARTIFACT_SHA256:-}" in
  ""|*[!0-9a-f]*) fail "migration artifact digest is invalid" ;;
esac
[ "${#MOLIT_EDC_MIGRATION_ARTIFACT_SHA256}" -eq 64 ] || fail "migration artifact digest is invalid"

actual_artifact="$(sha256sum /opt/molit-edc-schema/migration-manifest.v1.json | awk '{print $1}')"
[ "$actual_artifact" = "$MOLIT_EDC_MIGRATION_ARTIFACT_SHA256" ] || fail "migration artifact digest mismatch"
case "${EDC_DATASOURCE_DEFAULT_URL:-}" in
  jdbc:postgresql://*) ;;
  *) fail "database URL must use PostgreSQL JDBC syntax" ;;
esac
[ -s "${PGSSLROOTCERT:-}" ] || fail "database CA is absent"
case "$EDC_DATASOURCE_DEFAULT_URL" in
  *\?*) query="${EDC_DATASOURCE_DEFAULT_URL#*\?}" ;;
  *) fail "database URL is missing its TLS query contract" ;;
esac
sslmode_count=0
sslrootcert_count=0
old_ifs="$IFS"
IFS='&'
# Query parameters are data, not pathname patterns. Disable glob expansion while
# splitting so a crafted value cannot expand against files in the container.
set -f
set -- $query
set +f
IFS="$old_ifs"
for parameter do
  key="${parameter%%=*}"
  value="${parameter#*=}"
  [ "$key" != "$parameter" ] || fail "database URL query parameter is malformed"
  case "$key" in
    sslmode)
      sslmode_count=$((sslmode_count + 1))
      [ "$value" = "verify-full" ] || fail "database sslmode must be verify-full"
      ;;
    sslrootcert)
      sslrootcert_count=$((sslrootcert_count + 1))
      [ "$value" = "$PGSSLROOTCERT" ] || fail "database sslrootcert must equal the mounted CA path"
      ;;
  esac
done
[ "$sslmode_count" -eq 1 ] && [ "$sslrootcert_count" -eq 1 ] || fail "database URL must contain exactly one sslmode and sslrootcert"
[ -n "${EDC_DATASOURCE_DEFAULT_USER:-}" ] || fail "database username is absent"
[ -n "${EDC_DATASOURCE_DEFAULT_PASSWORD:-}" ] || fail "database password is absent"
if [ -n "${PGSSLCERT:-}${PGSSLKEY:-}" ]; then
  [ -s "${PGSSLCERT:-}" ] && [ -s "${PGSSLKEY:-}" ] || fail "client certificate and key must be supplied together"
fi

export PGUSER="$EDC_DATASOURCE_DEFAULT_USER"
export PGPASSWORD="$EDC_DATASOURCE_DEFAULT_PASSWORD"
export PGCONNECT_TIMEOUT=10
database_url="${EDC_DATASOURCE_DEFAULT_URL#jdbc:}"
component_directory="/opt/molit-edc-schema/$MOLIT_EDC_SCHEMA_COMPONENT"
migration_file="/tmp/molit-edc-migration.sql"

{
  printf '%s\n' 'BEGIN;'
  for sql in "$component_directory"/*.sql; do cat "$sql"; printf '\n'; done
  cat <<'SQL'
CREATE TABLE IF NOT EXISTS molit_edc_schema_version
(
  component       VARCHAR PRIMARY KEY,
  required_version VARCHAR NOT NULL,
  artifact_sha256  CHAR(64) NOT NULL,
  applied_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO molit_edc_schema_version(component, required_version, artifact_sha256, applied_at)
VALUES (:'component', :'required_version', :'artifact_sha256', CURRENT_TIMESTAMP)
ON CONFLICT (component) DO UPDATE
SET required_version = EXCLUDED.required_version,
    artifact_sha256 = EXCLUDED.artifact_sha256,
    applied_at = EXCLUDED.applied_at;
COMMIT;
SQL
} > "$migration_file"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -v component="$MOLIT_EDC_SCHEMA_COMPONENT" \
  -v required_version="$MOLIT_EDC_REQUIRED_SCHEMA_VERSION" \
  -v artifact_sha256="$MOLIT_EDC_MIGRATION_ARTIFACT_SHA256" \
  -f "$migration_file"

case "$MOLIT_EDC_SCHEMA_COMPONENT" in
  control-plane)
    required_tables="edc_asset edc_contract_definitions edc_contract_agreement edc_contract_negotiation edc_policydefinitions edc_transfer_process edc_edr_entry edc_jti_validation edc_data_plane_instance edc_policy_monitor edc_federated_catalog edc_target_node_directory"
    expected_count=12
    ;;
  data-plane)
    required_tables="edc_accesstokendata edc_data_plane"
    expected_count=2
    ;;
esac

table_values=""
for table in $required_tables; do
  if [ -n "$table_values" ]; then table_values="$table_values,"; fi
  table_values="${table_values}'${table}'"
done
actual_count="$(psql "$database_url" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM unnest(ARRAY[$table_values]) AS required(name) WHERE to_regclass('public.' || name) IS NOT NULL")"
[ "$actual_count" = "$expected_count" ] || fail "required EDC tables are absent after migration"
marker_count="$(psql "$database_url" -X -A -t -v ON_ERROR_STOP=1 \
  -c "SELECT count(*) FROM molit_edc_schema_version WHERE component = '$MOLIT_EDC_SCHEMA_COMPONENT' AND required_version = '$MOLIT_EDC_REQUIRED_SCHEMA_VERSION' AND artifact_sha256 = '$MOLIT_EDC_MIGRATION_ARTIFACT_SHA256'")"
[ "$marker_count" = "1" ] || fail "schema version marker verification failed"
printf 'schemaMigrationVerified=true component=%s version=%s\n' "$MOLIT_EDC_SCHEMA_COMPONENT" "$MOLIT_EDC_REQUIRED_SCHEMA_VERSION"
