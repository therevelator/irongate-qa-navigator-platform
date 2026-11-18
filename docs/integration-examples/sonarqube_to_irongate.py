#!/usr/bin/env python3
"""
Send test coverage and the code quality score of a SonarQube / SonarCloud project to IronGate.

    export SONAR_URL=https://sonar.example.com        # or https://sonarcloud.io
    export SONAR_TOKEN=squ_...                         # a user token with Browse permission on the project
    export IRONGATE_URL=https://qe.example.com/api IRONGATE_API_KEY=igk_...
    python3 sonarqube_to_irongate.py --team <team id> --project <sonar project key> [--dry-run]

Reads GET /api/measures/component?component=<key>&metricKeys=coverage,ncloc,sqale_rating,
reliability_rating,security_rating and sends
    test_coverage      = SonarQube `coverage` (%)
    code_quality_score = Maintainability x 0.40 + Reliability x 0.35 + Security x 0.25,
                         each rating A=100, B=80, C=60, D=40, E=20 (SonarQube returns 1.0 .. 5.0)
                         (the same calculator as Manual metrics -> Code quality score)
Prints `ncloc` (lines of code) so a later step can compute defect density (jira_to_irongate.py --ncloc).
"""
import argparse
import json
import os
import sys
import time

import requests

from irongate_ingest import IronGateClient, summarise

RATING_SCORE = {1: 100, 2: 80, 3: 60, 4: 40, 5: 20}


def code_quality_score(measures: dict) -> int:
    score = lambda key: RATING_SCORE[round(float(measures[key]))]  # noqa: E731
    return round(score("sqale_rating") * 0.40 + score("reliability_rating") * 0.35 + score("security_rating") * 0.25)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--team", required=True)
    p.add_argument("--project", required=True)
    p.add_argument("--branch")
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args()

    params = {"component": a.project, "metricKeys": "coverage,ncloc,sqale_rating,reliability_rating,security_rating"}
    if a.branch:
        params["branch"] = a.branch
    r = requests.get(f"{os.environ['SONAR_URL'].rstrip('/')}/api/measures/component", params=params,
                     headers={"Authorization": f"Bearer {os.environ['SONAR_TOKEN']}"}, timeout=30)
    r.raise_for_status()
    measures = {m["metric"]: m.get("value") for m in r.json()["component"]["measures"]}

    metrics = {}
    if measures.get("coverage") is not None:
        metrics["test_coverage"] = float(measures["coverage"])
    if all(measures.get(k) is not None for k in ("sqale_rating", "reliability_rating", "security_rating")):
        metrics["code_quality_score"] = code_quality_score(measures)
    print(f"ncloc={measures.get('ncloc')}", file=sys.stderr)
    if not metrics:
        print("SonarQube returned no coverage and no ratings; nothing to send", file=sys.stderr)
        return 1

    item = {"teamId": a.team, "source": "sonarqube", "recordedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "metrics": metrics, "sourceRef": f"sonar project {a.project}" + (f" branch {a.branch}" if a.branch else "")}
    if a.dry_run:
        print(json.dumps(item, indent=2))
        return 0
    summarise(IronGateClient().send([item]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
