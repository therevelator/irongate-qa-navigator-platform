#!/usr/bin/env python3
"""
Send defect metrics computed from Jira JQL counts to IronGate.

Note: raw issue ingestion (POST /api/ingest/issues, docs/INTEGRATION_GUIDE.md section 4C) lets QE
Navigator calculate these metrics from the issues themselves. This script sends computed values to
POST /api/ingest/kpis and still works.

    export JIRA_URL=https://your-site.atlassian.net
    export JIRA_USER=integration.bot@example.com JIRA_TOKEN=...       # Jira Cloud: e-mail + API token
    export IRONGATE_URL=https://qe.example.com/api IRONGATE_API_KEY=igk_...
    python3 jira_to_irongate.py --team <team id> --project PAY --days 30 [--ncloc 182000] [--dry-run]

Counts (window: issues created in the last --days days):
    all_bugs   = issuetype = Bug AND project = <key> AND created >= -<days>d
    prod_bugs  = all_bugs AND <--prod-filter>   (default: labels = production; adapt to your
                 "found in" / Environment field, e.g. '"Found in[Dropdown]" = Production')
Sends
    defect_escape_rate = prod_bugs / all_bugs x 100            (only when all_bugs > 0)
    defect_density     = all_bugs / (ncloc / 1000)              (only with --ncloc, e.g. SonarQube ncloc)

Jira Cloud: POST /rest/api/3/search/approximate-count {"jql": ...} -> {"count": n}.
Jira Server / Data Center: use --server, GET /rest/api/2/search?jql=...&maxResults=0 -> {"total": n}
(with a personal access token in JIRA_TOKEN and no JIRA_USER).
"""
import argparse
import json
import os
import sys
import time

import requests

from irongate_ingest import IronGateClient, summarise


def count(jql: str, server: bool) -> int:
    base = os.environ["JIRA_URL"].rstrip("/")
    user, token = os.environ.get("JIRA_USER"), os.environ["JIRA_TOKEN"]
    auth = (user, token) if user else None
    headers = {} if user else {"Authorization": f"Bearer {token}"}
    if server:
        r = requests.get(f"{base}/rest/api/2/search", params={"jql": jql, "maxResults": 0}, auth=auth, headers=headers, timeout=30)
        r.raise_for_status()
        return int(r.json()["total"])
    r = requests.post(f"{base}/rest/api/3/search/approximate-count", json={"jql": jql}, auth=auth, headers=headers, timeout=30)
    r.raise_for_status()
    return int(r.json()["count"])


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--team", required=True)
    p.add_argument("--project", required=True)
    p.add_argument("--days", type=int, default=30)
    p.add_argument("--prod-filter", default="labels = production")
    p.add_argument("--ncloc", type=float, help="lines of code (SonarQube ncloc) for defect density")
    p.add_argument("--server", action="store_true", help="Jira Server / Data Center API")
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args()

    base_jql = f'issuetype = Bug AND project = "{a.project}" AND created >= -{a.days}d'
    all_bugs = count(base_jql, a.server)
    prod_bugs = count(f"{base_jql} AND {a.prod_filter}", a.server)
    print(f"bugs in {a.days}d: {all_bugs}, found in production: {prod_bugs}", file=sys.stderr)

    metrics = {}
    if all_bugs > 0:
        metrics["defect_escape_rate"] = round(prod_bugs / all_bugs * 100, 2)
    if a.ncloc:
        metrics["defect_density"] = round(all_bugs / (a.ncloc / 1000), 3)
    if not metrics:
        print("no bugs in the window and no --ncloc: nothing to send (0 bugs is not sent as 0 %)", file=sys.stderr)
        return 0

    item = {"teamId": a.team, "source": "jira", "recordedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "metrics": metrics, "sourceRef": f"JQL: {base_jql}"[:500]}
    if a.dry_run:
        print(json.dumps(item, indent=2))
        return 0
    summarise(IronGateClient().send([item]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
