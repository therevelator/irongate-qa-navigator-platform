"""
Minimal client for the IronGate QE Navigator KPI ingestion API (POST /api/ingest/kpis).

    from irongate_ingest import IronGateClient
    client = IronGateClient()                      # reads IRONGATE_URL and IRONGATE_API_KEY
    client.send([{"teamId": "...", "source": "jenkins", "recordedAt": "2026-11-18T06:00:00Z",
                  "metrics": {"avg_build_time_minutes": 9}}])

What it does for you
  * Authorization: Bearer <igk_ key>   (the key is never printed or logged)
  * an Idempotency-Key header derived from the request body (sha256), reused on every retry,
    so a retried request is answered from the stored result and never written twice
  * retries with exponential backoff + jitter on network errors, 429 and 5xx
    (honours the RateLimit-Reset / Retry-After headers); never retries 4xx validation errors
  * splits more than 100 items into several requests (the API accepts 1-100 items per request)

Requirements: Python 3.8+, `pip install requests`.
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import time
from typing import Any, Dict, Iterable, List, Optional

import requests

MAX_BATCH = 100
RETRY_STATUSES = {429, 500, 502, 503, 504}


class IngestError(Exception):
    """A request the API refused (4xx) or that kept failing after all retries."""

    def __init__(self, status: int, body: Any):
        super().__init__(f"HTTP {status}: {json.dumps(body)[:2000]}")
        self.status = status
        self.body = body


def utc_now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def canonical_json(body: Any) -> str:
    # Stable serialisation: the same logical request always produces the same bytes (and key).
    return json.dumps(body, sort_keys=True, separators=(",", ":"))


class IronGateClient:
    def __init__(self, base_url: Optional[str] = None, api_key: Optional[str] = None,
                 max_attempts: int = 6, timeout: float = 120.0):
        self.base_url = (base_url or os.environ["IRONGATE_URL"]).rstrip("/")  # e.g. https://qe.example.com/api
        self._api_key = api_key or os.environ["IRONGATE_API_KEY"]
        if not self._api_key.startswith("igk_"):
            raise ValueError("IRONGATE_API_KEY must be an IronGate ingestion key (igk_...)")
        self.max_attempts = max_attempts
        self.timeout = timeout
        self.session = requests.Session()

    def __repr__(self) -> str:  # never expose the key
        return f"IronGateClient({self.base_url!r}, api_key='igk_***')"

    def send(self, items: List[Dict[str, Any]], partial: bool = False,
             key_prefix: str = "") -> List[Dict[str, Any]]:
        """Send any number of items, 100 per request. Returns the parsed responses."""
        responses = []
        for start in range(0, len(items), MAX_BATCH):
            chunk = items[start:start + MAX_BATCH]
            responses.append(self.post(chunk, partial=partial, key_prefix=key_prefix))
        return responses

    def post(self, body: Any, partial: bool = False, key_prefix: str = "") -> Dict[str, Any]:
        """One request (an item object or a list of up to 100 items), with retries."""
        payload = canonical_json(body)
        idem_key = (key_prefix + hashlib.sha256(payload.encode()).hexdigest())[:200]
        url = f"{self.base_url}/ingest/kpis" + ("?partial=true" if partial else "")
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "Idempotency-Key": idem_key,
        }
        delay = 1.0
        for attempt in range(1, self.max_attempts + 1):
            try:
                r = self.session.post(url, data=payload, headers=headers, timeout=self.timeout)
            except requests.RequestException as exc:  # network error: safe to retry with the same key
                if attempt == self.max_attempts:
                    raise
                print(f"[irongate] network error ({exc.__class__.__name__}), retry {attempt}")
                self._sleep(delay)
                delay = min(delay * 2, 60)
                continue
            data = _json(r)
            if r.status_code in (200, 207):
                if r.headers.get("Idempotent-Replayed") == "true":
                    print("[irongate] already processed earlier: stored result returned, nothing written")
                return data
            if r.status_code in RETRY_STATUSES and attempt < self.max_attempts:
                wait = _retry_after(r) or delay
                print(f"[irongate] HTTP {r.status_code}, retry {attempt} in {wait:.1f}s")
                self._sleep(wait)
                delay = min(delay * 2, 60)
                continue
            raise IngestError(r.status_code, data)
        raise IngestError(0, {"error": "unreachable"})

    @staticmethod
    def _sleep(seconds: float) -> None:
        time.sleep(seconds + random.uniform(0, seconds / 4))


def _json(r: requests.Response) -> Any:
    try:
        return r.json()
    except ValueError:
        return {"error": r.text[:500]}


def _retry_after(r: requests.Response) -> Optional[float]:
    for h in ("Retry-After", "RateLimit-Reset"):
        v = r.headers.get(h)
        if v and v.isdigit():
            return float(v)
    return None


def summarise(responses: Iterable[Dict[str, Any]]) -> None:
    """Print one line per item: written / duplicate / error."""
    for resp in responses:
        print(f"request {resp.get('ingestionId')}: {resp.get('status')}")
        for item in resp.get("items", []):
            line = f"  #{item['index']} team={item.get('teamId')} day={item.get('snapshotDate')} {item['status']}"
            if item.get("errors"):
                line += f" errors={item['errors']}"
            print(line)
