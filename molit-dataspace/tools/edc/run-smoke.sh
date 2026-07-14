#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
compose="$repo/deploy/edc/compose.yaml"
overlay="$repo/deploy/edc/compose.smoke.yaml"
recorder="$repo/tools/edc/record-smoke.mjs"
record_evidence=""

while (( $# > 0 )); do
  case "$1" in
    --record-evidence)
      [[ $# -ge 2 && -n "$2" ]] || { printf '%s\n' '--record-evidence requires a path' >&2; exit 2; }
      record_evidence="$2"
      shift 2
      ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

random_hex() {
  od -An -N24 -tx1 /dev/urandom | tr -d ' \n'
}

export EDC_POSTGRES_PASSWORD="$(random_hex)"
export PROVIDER_API_KEY="$(random_hex)"
export CONSUMER_API_KEY="$(random_hex)"

temporary=""
prepare_file=""
stdout_file=""
images_file=""
run_status=1
clean_start_status="not-run"

if [[ -n "$record_evidence" ]]; then
  temporary="$(mktemp -d "${TMPDIR:-/tmp}/molit-edc-evidence.XXXXXXXX")"
  prepare_file="$temporary/prepare.json"
  stdout_file="$temporary/stdout.txt"
  images_file="$temporary/images.tsv"
  : > "$stdout_file"
  : > "$images_file"
  set +e
  node "$recorder" prepare --state "$prepare_file" --command "bash tools/edc/run-smoke.sh --record-evidence $record_evidence"
  prepare_status=$?
  set -e
  if [[ $prepare_status -ne 0 ]]; then
    rm -rf -- "$temporary"
    unset EDC_POSTGRES_PASSWORD PROVIDER_API_KEY CONSUMER_API_KEY
    exit "$prepare_status"
  fi
fi

wait_for_healthy() {
  local service="$1"
  local deadline=$((SECONDS + 300))
  local container_id status
  while (( SECONDS < deadline )); do
    container_id="$(docker compose -f "$compose" -f "$overlay" ps -q "$service")"
    if [[ -n "$container_id" ]]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
      case "$status" in
        healthy) return 0 ;;
        dead|exited|unhealthy)
          printf '%s entered terminal status %s before the smoke test\n' "$service" "$status" >&2
          return 1
          ;;
      esac
    fi
    sleep 2
  done
  printf '%s did not become healthy within 300 seconds\n' "$service" >&2
  return 1
}

cleanup() {
  local original_status=$?
  local cleanup_status="not-run"
  local recorder_status=0
  trap - EXIT
  set +e
  if [[ -n "$record_evidence" ]]; then
    : > "$images_file"
    local service image_id
    for service in provider-control-plane provider-data-plane consumer-control-plane consumer-data-plane provider-backend smoke; do
      image_id="$(docker compose -f "$compose" -f "$overlay" images -q "$service" 2>/dev/null)"
      if [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]]; then printf '%s\t%s\n' "$service" "$image_id" >> "$images_file"; fi
    done
  fi
  if [[ "${KEEP_EDC_SMOKE:-0}" != "1" ]]; then
    docker compose -f "$compose" -f "$overlay" down --volumes --remove-orphans
    if [[ $? -eq 0 ]]; then cleanup_status="pass"; else cleanup_status="failed"; fi
  else
    cleanup_status="kept"
  fi
  if [[ "$cleanup_status" == "failed" && $original_status -eq 0 ]]; then
    original_status=1
    run_status=1
  fi
  if [[ -n "$record_evidence" ]]; then
    node "$recorder" complete --state "$prepare_file" --stdout "$stdout_file" --images "$images_file" \
      --output "$record_evidence" --exit-code "$run_status" --clean-start "$clean_start_status" \
      --cleanup "$cleanup_status"
    recorder_status=$?
  fi
  unset EDC_POSTGRES_PASSWORD PROVIDER_API_KEY CONSUMER_API_KEY
  if [[ -n "$temporary" ]]; then rm -rf -- "$temporary"; fi
  if [[ $original_status -eq 0 && $recorder_status -ne 0 ]]; then original_status=$recorder_status; fi
  exit "$original_status"
}
trap cleanup EXIT

docker compose -f "$compose" -f "$overlay" down --volumes --remove-orphans
clean_start_status="pass"
docker compose -f "$compose" -f "$overlay" up --detach --build \
  provider-control-plane provider-data-plane consumer-control-plane consumer-data-plane provider-backend
wait_for_healthy 'provider-control-plane'
wait_for_healthy 'provider-data-plane'
wait_for_healthy 'consumer-control-plane'
wait_for_healthy 'consumer-data-plane'
wait_for_healthy 'provider-backend'
# --no-deps prevents the one-shot key generator from replacing the key material
# after every required process has passed its health check.
if [[ -n "$record_evidence" ]]; then
  set +e
  docker compose -f "$compose" -f "$overlay" run --rm --no-deps --use-aliases smoke | tee "$stdout_file"
  run_status=${PIPESTATUS[0]}
  set -e
  if [[ $run_status -ne 0 ]]; then exit "$run_status"; fi
else
  docker compose -f "$compose" -f "$overlay" run --rm --no-deps --use-aliases smoke
  run_status=$?
fi
