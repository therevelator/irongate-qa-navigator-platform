#!/usr/bin/env python3
r"""
Send test coverage, test execution time and build time from a CI job to IronGate.

    python3 ci_report_to_irongate.py --team <team id> --source github-actions \
        --coverage coverage/coverage-summary.json \   # or cobertura.xml, jacoco.xml, lcov.info
        --junit "reports/junit/*.xml" \               # -> test_execution_time_minutes
        --build-seconds 412 \                         # -> avg_build_time_minutes
        --ref "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"

Environment: IRONGATE_URL (ending in /api), IRONGATE_API_KEY (igk_...).
Add --dry-run to print the request instead of sending it.

Coverage formats (line coverage = covered lines / executable lines x 100):
  * Istanbul / nyc   coverage-summary.json      total.lines.pct
  * Cobertura XML    (coverage.py, Istanbul, gcovr, ...)   <coverage line-rate="0.81"> x 100
  * JaCoCo XML       report-level <counter type="LINE" missed= covered=>
  * LCOV             sum(LH) / sum(LF)

Only parse reports produced by your own build (xml.etree is not hardened against hostile XML).
"""
import argparse
import glob
import json
import sys
import time
import xml.etree.ElementTree as ET

from irongate_ingest import IronGateClient, summarise


def line_coverage(path: str) -> float:
    if path.endswith(".json"):
        with open(path) as f:
            return float(json.load(f)["total"]["lines"]["pct"])
    if path.endswith(".info") or "lcov" in path:
        found = hit = 0
        with open(path) as f:
            for line in f:
                if line.startswith("LF:"):
                    found += int(line[3:])
                elif line.startswith("LH:"):
                    hit += int(line[3:])
        if found == 0:
            raise ValueError("LCOV report has no executable lines")
        return hit / found * 100
    root = ET.parse(path).getroot()
    if root.tag == "coverage" and "line-rate" in root.attrib:  # Cobertura
        return float(root.attrib["line-rate"]) * 100
    if root.tag == "report":  # JaCoCo: the report-level counters are direct children of <report>
        for c in root.findall("counter"):
            if c.attrib.get("type") == "LINE":
                missed, covered = int(c.attrib["missed"]), int(c.attrib["covered"])
                return covered / (missed + covered) * 100
    raise ValueError(f"unrecognised coverage report: {path}")


def junit_minutes(pattern: str) -> float:
    """Total suite time across JUnit XML files (sum of <testsuite time>), in minutes."""
    seconds = 0.0
    files = glob.glob(pattern, recursive=True)
    if not files:
        raise ValueError(f"no JUnit files match {pattern}")
    for path in files:
        root = ET.parse(path).getroot()
        suites = [root] if root.tag == "testsuite" else root.findall("testsuite")
        seconds += sum(float(s.attrib.get("time", 0) or 0) for s in suites)
    return seconds / 60


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--team", required=True)
    p.add_argument("--source", default="ci")
    p.add_argument("--coverage")
    p.add_argument("--junit")
    p.add_argument("--build-seconds", type=float)
    p.add_argument("--ref", help="sourceRef: build URL or id (<= 500 chars)")
    p.add_argument("--run-id", help="stable id of this CI run, used for the per-item idempotency key")
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args()

    metrics = {}
    if a.coverage:
        metrics["test_coverage"] = round(line_coverage(a.coverage), 2)
    if a.junit:
        metrics["test_execution_time_minutes"] = round(junit_minutes(a.junit))  # integer column
    if a.build_seconds is not None:
        metrics["avg_build_time_minutes"] = round(a.build_seconds / 60)        # integer column
    if not metrics:
        p.error("nothing to send: give --coverage, --junit and/or --build-seconds")

    item = {
        "teamId": a.team,
        "source": a.source,
        "recordedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "metrics": metrics,
    }
    if a.ref:
        item["sourceRef"] = a.ref[:500]
    if a.run_id:
        item["idempotencyKey"] = f"{a.source}:{a.run_id}"[:200]

    if a.dry_run:
        print(json.dumps(item, indent=2))
        return 0
    responses = IronGateClient().send([item])
    summarise(responses)
    return 0


if __name__ == "__main__":
    sys.exit(main())
