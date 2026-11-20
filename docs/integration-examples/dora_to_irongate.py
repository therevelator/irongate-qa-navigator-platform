#!/usr/bin/env python3
"""
Compute the DORA / reliability KPIs from deployment and incident events and send them to IronGate,
for several teams in one request, optionally backfilling one value per day for the last N days.

SUPERSEDED: this script computes the values itself and sends them to POST /api/ingest/kpis. Prefer raw
ingestion ("raw data in, we calculate"): send each deployment to POST /api/ingest/deployments, its commits
to POST /api/ingest/commits and incidents to POST /api/ingest/incidents. QE Navigator then calculates
deployment frequency, lead time, change failure rate, MTTR, MTBF and availability with their evidence.
See docs/INTEGRATION_GUIDE.md, section 4B. This script still works.

    python3 dora_to_irongate.py events.json                    # today's values, all teams in the file
    python3 dora_to_irongate.py events.json --backfill-days 30 # plus one value per day for 30 days back
    python3 dora_to_irongate.py events.json --dry-run          # print the request instead of sending

Environment: IRONGATE_URL (ending in /api), IRONGATE_API_KEY (igk_...).
Input format: see sample-dora-events.json (export it from GitHub deployments / Argo CD / Jenkins
and PagerDuty / Opsgenie; one record per production deployment and per incident).

Definitions (trailing window of --window-days, default 28, ending at the "as of" time):
  deployment_frequency_per_week = successful production deployments in the window / (window days / 7)
  lead_time_days                = mean over the commits shipped by those deployments of
                                  (deployedAt - committedAt), in days
  change_failure_rate           = deployments in the window that caused a failure
                                  (causedFailure: true, or named by an incident) / deployments x 100
  mttr_hours                    = mean (resolvedAt - startedAt) of incidents resolved in the window, hours
  mtbf_hours                    = window hours / incidents started in the window (not sent with 0 incidents)
  system_availability           = (window minutes - outage minutes inside the window) / window minutes x 100
                                  (only incidents with "outage": true count as downtime)
A metric with no input in the window (no deployments, no resolved incidents) is left out, never sent as 0.
"""
import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from statistics import mean

from irongate_ingest import IronGateClient, summarise

SOURCE = "dora-job"


def ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def iso(d: datetime) -> str:
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def dora(deployments, incidents, as_of: datetime, window_days: int) -> dict:
    start = as_of - timedelta(days=window_days)
    deps = [d for d in deployments
            if d.get("environment", "production") == "production" and d.get("status", "success") == "success"
            and start < ts(d["deployedAt"]) <= as_of]
    out = {}
    out["deployment_frequency_per_week"] = round(len(deps) / (window_days / 7), 2)
    if deps:
        lead = [(ts(d["deployedAt"]) - ts(c["committedAt"])).total_seconds() / 86400
                for d in deps for c in d.get("commits", [])]
        if lead:
            out["lead_time_days"] = round(mean(lead), 2)
        failed_by_incident = {i.get("causedByDeployment") for i in incidents if i.get("causedByDeployment")}
        failed = [d for d in deps if d.get("causedFailure") or d["id"] in failed_by_incident]
        out["change_failure_rate"] = round(len(failed) / len(deps) * 100, 2)
    resolved = [i for i in incidents if i.get("resolvedAt") and start < ts(i["resolvedAt"]) <= as_of]
    if resolved:
        out["mttr_hours"] = round(mean((ts(i["resolvedAt"]) - ts(i["startedAt"])).total_seconds() / 3600
                                       for i in resolved), 2)
    started = [i for i in incidents if start < ts(i["startedAt"]) <= as_of]
    if started:
        out["mtbf_hours"] = round(window_days * 24 / len(started))  # integer column
    window_min = window_days * 24 * 60
    down = 0.0
    for i in incidents:
        if not i.get("outage"):
            continue
        s, e = max(ts(i["startedAt"]), start), min(ts(i["resolvedAt"]) if i.get("resolvedAt") else as_of, as_of)
        if e > s:
            down += (e - s).total_seconds() / 60
    out["system_availability"] = round((window_min - down) / window_min * 100, 3)
    return out


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("events")
    p.add_argument("--window-days", type=int, default=28)
    p.add_argument("--backfill-days", type=int, default=0, help="also send one value per past day (max 365)")
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args()
    if not 0 <= a.backfill_days <= 364:
        p.error("--backfill-days must be 0-364 (the API accepts values up to 365 days back)")

    with open(a.events) as f:
        ev = json.load(f)
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    teams = sorted({d["teamId"] for d in ev["deployments"]} | {i["teamId"] for i in ev["incidents"]})

    items = []
    for team in teams:
        deps = [d for d in ev["deployments"] if d["teamId"] == team]
        incs = [i for i in ev["incidents"] if i["teamId"] == team]
        # Past days: a fixed time (23:59 UTC) so a re-run sends the same recordedAt; when the numbers
        # changed it is stored as a correction of that day's value, when they did not the identical
        # request is answered from the stored result (Idempotency-Key = body hash). Today: now.
        points = [now.replace(hour=23, minute=59) - timedelta(days=k) for k in range(a.backfill_days, 0, -1)]
        points.append(now)
        for as_of in points:
            metrics = dora(deps, incs, as_of, a.window_days)
            items.append({"teamId": team, "source": SOURCE, "recordedAt": iso(as_of), "metrics": metrics,
                          "sourceRef": f"window {a.window_days}d to {iso(as_of)}"})

    if a.dry_run:
        print(json.dumps(items, indent=2))
        return 0
    # Several teams and days in as few requests as possible (100 items each, 60 requests/minute per key).
    # partial=true: one team's bad value does not block the other teams; check the per-item status.
    responses = IronGateClient().send(items, partial=True, key_prefix="dora:")
    summarise(responses)
    return 0 if all(r.get("status") == "accepted" for r in responses) else 1


if __name__ == "__main__":
    sys.exit(main())
