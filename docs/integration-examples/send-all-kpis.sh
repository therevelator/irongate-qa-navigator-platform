#!/usr/bin/env bash
# End-to-end check with curl: send one valid value for EVERY team KPI (23 columns) for one team.
#
#   export IRONGATE_URL=https://qe.example.com/api    # your instance, ending in /api
#   export IRONGATE_API_KEY=igk_...                   # Admin console -> API keys (super admin)
#   ./send-all-kpis.sh <team id>
#
# Prints the HTTP status and the JSON response. Exit code 0 only on HTTP 200.
set -euo pipefail

TEAM_ID=${1:?usage: send-all-kpis.sh <team id>}
: "${IRONGATE_URL:?set IRONGATE_URL (ending in /api)}"
: "${IRONGATE_API_KEY:?set IRONGATE_API_KEY (igk_...)}"
RECORDED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

BODY=$(cat <<JSON
{
  "teamId": "${TEAM_ID}",
  "source": "smoke-test",
  "recordedAt": "${RECORDED_AT}",
  "sourceRef": "docs/integration-examples/send-all-kpis.sh",
  "metrics": {
    "test_coverage": 81.5, "test_flakiness_rate": 1.8, "defect_density": 0.42, "defect_escape_rate": 4.5,
    "code_quality_score": 84, "automation_coverage": 72, "automation_roi": 135,
    "avg_build_time_minutes": 9, "test_execution_time_minutes": 14, "deployment_frequency_per_week": 6.5,
    "lead_time_days": 1.8, "mttr_hours": 1.5, "parallel_test_efficiency": 82,
    "sprint_velocity": 42, "sprint_commitment_rate": 92, "sprint_carryover": 8, "first_time_pass_rate": 88,
    "blocked_time_hours": 3, "sizing_accuracy": 1.05,
    "change_failure_rate": 4, "mtbf_hours": 800, "system_availability": 99.95, "infrastructure_failures": 1
  }
}
JSON
)

# The Authorization header is read from a file descriptor (-H @file, curl 7.55+), so the key
# never appears in the process list or in this script's output.
# --retry retries timeouts, 408, 429 and 5xx (honouring Retry-After), never 400/401/403/422;
# the Idempotency-Key makes a retry safe (an already processed request is replayed, not re-written).
RESPONSE=$(mktemp)
trap 'rm -f "$RESPONSE"' EXIT
STATUS=$(curl -sS -o "$RESPONSE" -w '%{http_code}' -X POST "${IRONGATE_URL%/}/ingest/kpis" \
  -H @<(printf 'Authorization: Bearer %s\n' "$IRONGATE_API_KEY") \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: smoke-test:${TEAM_ID}:${RECORDED_AT}" \
  --retry 5 --retry-delay 2 \
  -d "${BODY}")
cat "$RESPONSE"
echo
echo "HTTP ${STATUS}"
[ "${STATUS}" = "200" ]
