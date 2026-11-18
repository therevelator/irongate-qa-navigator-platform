#!/usr/bin/env python3
"""
Backfill KPI history (up to 365 days back) from a CSV export, many teams at once.

    python3 backfill_csv.py history.csv --source jira-export [--dry-run]

CSV columns (header required; see sample-history.csv):
    team_id,date,metric,value
    team-123,2026-08-01,defect_escape_rate,6.5
`date` is YYYY-MM-DD (sent as that day 23:59:00 UTC, i.e. the value as of the end of that day) or a
full ISO 8601 timestamp. `metric` is a KPI key (KPI_COLUMNS). Rows of the same team and time are
combined into one item; items are sent 100 per request with ?partial=true, so one bad row does not
block the rest, and every rejected row is printed.

Re-running the same file is safe: identical requests are answered from the stored result
(Idempotency-Key = hash of the request), and a changed value for the same team, metric and time is
stored as a correction of the earlier one.

Environment: IRONGATE_URL (ending in /api), IRONGATE_API_KEY (igk_...).
"""
import argparse
import csv
import json
import re
import sys
from collections import OrderedDict

from irongate_ingest import IronGateClient, IngestError

DATE_ONLY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("csv")
    p.add_argument("--source", required=True, help='source label, e.g. "jira-export" (not "manual")')
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args()

    items: "OrderedDict[tuple, dict]" = OrderedDict()
    with open(a.csv, newline="") as f:
        for row in csv.DictReader(f):
            when = row["date"].strip()
            recorded_at = f"{when}T23:59:00Z" if DATE_ONLY.match(when) else when
            key = (row["team_id"].strip(), recorded_at)
            item = items.setdefault(key, {"teamId": key[0], "source": a.source, "recordedAt": recorded_at,
                                          "metrics": {}, "sourceRef": f"backfill {a.csv}"})
            value = row["value"].strip()
            item["metrics"][row["metric"].strip()] = float(value) if value else None

    batch = list(items.values())
    print(f"{len(batch)} items ({sum(len(i['metrics']) for i in batch)} values) in {(len(batch) + 99) // 100} request(s)")
    if a.dry_run:
        print(json.dumps(batch[:3], indent=2), "...")
        return 0
    try:
        responses = IronGateClient().send(batch, partial=True, key_prefix="backfill:")
    except IngestError as e:  # e.g. 400 "No item could be written" when every item of a request is invalid
        print(e)
        return 1
    rejected = [it for r in responses for it in r.get("items", []) if it["status"] == "error"]
    for it in rejected:
        print(f"rejected: team={it['teamId']} at={it['recordedAt']} {it['errors']}")
    print(f"done: {len(batch) - len(rejected)} items written or already present, {len(rejected)} rejected")
    return 1 if rejected else 0


if __name__ == "__main__":
    sys.exit(main())
