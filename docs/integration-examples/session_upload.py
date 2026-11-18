#!/usr/bin/env python3
"""
Upload data that the KPI ingestion API does NOT accept, through the app's own (session-
authenticated) endpoints: developer metrics, business-impact monthly data and technical-debt
ROI inputs.

!! These endpoints are internal: they are what the web app calls, they authenticate a USER
!! (not an API key), they are not versioned and may change without notice, they are not
!! recorded in the ingestion log and they are not idempotent. Prefer entering this data in the
!! app (Manual metrics / Business impact page) unless you need automation. See
!! docs/INTEGRATION_GUIDE.md, section 5.

    export IRONGATE_URL=https://qe.example.com/api
    export IRONGATE_USER=integration.bot@example.com      # a dedicated, password-based account
    export IRONGATE_PASSWORD=...                          # from your secret store, never hard-coded
    python3 session_upload.py developer  developer-metrics.json
    python3 session_upload.py business   business-months.json
    python3 session_upload.py debt-impact debt-impact.json

Input formats: see the examples printed by `python3 session_upload.py formats`.
"""
import json
import os
import sys

import requests

FORMATS = {
    "developer": [{"teamId": "<team id>", "developerId": "<user id>", "prMergeTimeAvg": 6.5, "codeReviewTimeAvg": 3.2,
                   "focusTimeHours": 4.5, "meetingTimeHours": 2.5, "contextSwitchesPerDay": 5}],
    "business": {"teamId": "<team id>", "monthlyData": [
        {"month_year": "2026-10",
         "quality": {"test_coverage": 78.4, "defect_density": 0.6, "defect_escape_rate": 6.2, "mttr_hours": 3.1,
                     "deployment_frequency": 22, "lead_time_days": 2.4, "code_quality_score": 82, "change_failure_rate": 7.5},
         "kpis": {"monthly_revenue": 1250000, "active_users": 48200, "churn_rate": 2.1, "feature_adoption_rate": 34.5,
                  "nps_score": 41, "csat_score": 4.4, "support_ticket_volume": 930},
         "context": {"team_size": 7, "feature_release_count": 6, "downtime_minutes": 42}}]},
    "debt-impact": [{"id": "<technical debt item id>", "affected_users": 1200, "support_tickets_monthly": 14,
                     "downtime_minutes_monthly": 30, "revenue_impact_percent": 2.5, "sla_breaches_monthly": 1,
                     "estimated_effort_hours": 40}],
}


def workload_balance(m: dict) -> float:
    """Same formula as the app (calculateWorkloadBalance, src/data/advancedFeatures.ts), 0-100."""
    focus, meet = m["focusTimeHours"], m["meetingTimeHours"]
    tracked = focus + meet
    focus_score = min((focus / tracked if tracked > 0 else 0) * 100, 100) * 0.4
    context = max(0, (10 - m["contextSwitchesPerDay"]) / 10 * 100) * 0.3
    meeting = max(0, (4 - meet) / 4 * 100) * 0.15
    pr = max(0, (24 - m["prMergeTimeAvg"]) / 24 * 100) * 0.075
    review = max(0, (8 - m["codeReviewTimeAvg"]) / 8 * 100) * 0.075
    return round(min(100, max(0, focus_score + context + meeting + pr + review)), 1)


def login(base: str) -> requests.Session:
    s = requests.Session()
    r = s.post(f"{base}/auth/login", json={"email": os.environ["IRONGATE_USER"], "password": os.environ["IRONGATE_PASSWORD"]},
               timeout=30)
    if r.status_code != 200:
        raise SystemExit(f"login failed: HTTP {r.status_code} {r.text[:200]}")
    # The session is the httpOnly cookie irongate_token (valid 7 days); requests keeps it in s.cookies.
    return s


def check(r: requests.Response, what: str) -> None:
    if r.status_code != 200:
        raise SystemExit(f"{what}: HTTP {r.status_code} {r.text[:300]}")
    print(f"{what}: OK {r.text[:120]}")


def main() -> int:
    if len(sys.argv) == 2 and sys.argv[1] == "formats":
        print(json.dumps(FORMATS, indent=2))
        return 0
    if len(sys.argv) != 3 or sys.argv[1] not in FORMATS:
        print(__doc__)
        return 2
    kind, path = sys.argv[1], sys.argv[2]
    base = os.environ["IRONGATE_URL"].rstrip("/")
    with open(path) as f:
        data = json.load(f)
    s = login(base)

    if kind == "developer":
        # POST /api/metrics/developer replaces the developer's whole row for the team:
        # always send all five inputs (a missing one is stored as empty) plus the derived score.
        for m in data:
            body = dict(m, happinessScore=workload_balance(m))
            check(s.post(f"{base}/metrics/developer", json=body, timeout=30), f"developer {m['developerId']}")
    elif kind == "business":
        # POST /api/analytics/business-impact-v2/:teamId/bulk-save: per month, empty fields keep the stored value.
        r = s.post(f"{base}/analytics/business-impact-v2/{data['teamId']}/bulk-save",
                   json={"monthlyData": data["monthlyData"]}, timeout=60)
        check(r, f"business impact {len(data['monthlyData'])} month(s)")
    elif kind == "debt-impact":
        # PUT /api/analytics/technical-debt/:id/impact sets ALL six inputs: a missing one is cleared.
        for item in data:
            item = dict(item)
            debt_id = item.pop("id")
            check(s.put(f"{base}/analytics/technical-debt/{debt_id}/impact", json=item, timeout=30), f"debt {debt_id}")
    s.post(f"{base}/auth/logout", timeout=10)
    return 0


if __name__ == "__main__":
    sys.exit(main())
