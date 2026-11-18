#!/usr/bin/env python3
"""
End-to-end check: send one valid value for EVERY team KPI (all 23 writable columns) for one team,
then print what the platform stored.

    export IRONGATE_URL=https://qe.example.com/api     # your instance, ending in /api
    export IRONGATE_API_KEY=igk_...                    # Admin console -> API keys (super admin)
    python3 send_all_kpis.py <team id>

The values are plausible placeholders: replace them with real measurements before using this
for anything but a smoke test. Requires Python 3.8+ and `pip install requests`.
"""
import json
import os
import sys
import time

import requests

# One value per KPI column (server/lib/kpiIngest.ts, KPI_COLUMNS). Units in the comments.
ALL_KPIS = {
    # Quality and testing
    "test_coverage": 81.5,                 # %, 0-100
    "test_flakiness_rate": 1.8,            # %, 0-100
    "defect_density": 0.42,                # defects per KLOC, 0-999.999
    "defect_escape_rate": 4.5,             # %, 0-100
    "code_quality_score": 84,              # 0-100, whole number
    "automation_coverage": 72.0,           # %, 0-100
    "automation_roi": 135.0,               # %, -9999.99 to 9999.99
    # Speed and efficiency
    "avg_build_time_minutes": 9,           # minutes, whole number
    "test_execution_time_minutes": 14,     # minutes, whole number
    "deployment_frequency_per_week": 6.5,  # deployments per week
    "lead_time_days": 1.8,                 # days, 0-99.99
    "mttr_hours": 1.5,                     # hours
    "parallel_test_efficiency": 82.0,      # %, 0-100
    # Agile and process
    "sprint_velocity": 42,                 # story points, whole number
    "sprint_commitment_rate": 92.0,        # %, 0-999.99
    "sprint_carryover": 8.0,               # %, 0-100
    "first_time_pass_rate": 88.0,          # %, 0-100
    "blocked_time_hours": 3,               # hours, whole number
    "sizing_accuracy": 1.05,               # ratio actual/estimate, 0-99.99
    # Reliability and stability
    "change_failure_rate": 4.0,            # %, 0-100
    "mtbf_hours": 800,                     # hours, whole number
    "system_availability": 99.95,          # %, 0-100 (3 decimals)
    "infrastructure_failures": 1,          # count, whole number
}


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    team_id = sys.argv[1]
    base = os.environ["IRONGATE_URL"].rstrip("/")
    key = os.environ["IRONGATE_API_KEY"]
    recorded_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    body = {
        "teamId": team_id,
        "source": "smoke-test",
        "recordedAt": recorded_at,
        "sourceRef": "docs/integration-examples/send_all_kpis.py",
        "metrics": ALL_KPIS,
    }
    r = requests.post(
        f"{base}/ingest/kpis",
        json=body,
        headers={
            "Authorization": f"Bearer {key}",
            # One key per logical request: a retry of this exact request is never written twice.
            "Idempotency-Key": f"smoke-test:{team_id}:{recorded_at}",
        },
        timeout=30,
    )
    data = r.json()
    print(f"HTTP {r.status_code}")
    print(json.dumps(data, indent=2))
    if r.status_code != 200:
        return 1
    result = data["result"]
    missing = sorted(set(ALL_KPIS) - set(result["updated"]))
    print(f"\nsnapshot {result['snapshotDate']}: {len(result['updated'])} of {len(ALL_KPIS)} KPIs written, "
          f"QA score {result['qaScore']} ({result['status']})")
    if missing:
        print("not written:", ", ".join(missing))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
