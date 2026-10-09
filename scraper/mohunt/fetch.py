"""Polite HTTP fetching with an on-disk raw cache under data/raw/."""
from __future__ import annotations

import time
from pathlib import Path

import requests

USER_AGENT = "mo-hunt-stats scraper (+https://github.com/sudonate91/mo-hunt-stats)"
SLEEP_SECONDS = 2.0
REPO_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = REPO_ROOT / "data" / "raw"

BLOCKED_HOSTS = ("extra.mdc.mo.gov",)

_last_request = 0.0


def fetch(url: str, cache_path: Path, *, refresh: bool = False) -> str:
    """Return the page body, from cache if present; otherwise fetch, sleep, and cache."""
    global _last_request
    for host in BLOCKED_HOSTS:
        if host in url:
            raise RuntimeError(f"refusing to fetch {url}: {host} disallows bots in robots.txt")
    if cache_path.exists() and not refresh:
        return cache_path.read_text(encoding="utf-8")
    wait = SLEEP_SECONDS - (time.monotonic() - _last_request)
    if wait > 0:
        time.sleep(wait)
    resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=60)
    _last_request = time.monotonic()
    resp.raise_for_status()
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(resp.text, encoding="utf-8")
    return resp.text


def fetch_bytes(url: str, cache_path: Path, *, refresh: bool = False) -> bytes:
    """Binary variant of fetch(): same blocklist, user-agent, sleep and cache behavior."""
    global _last_request
    for host in BLOCKED_HOSTS:
        if host in url:
            raise RuntimeError(f"refusing to fetch {url}: {host} disallows bots in robots.txt")
    if cache_path.exists() and not refresh:
        return cache_path.read_bytes()
    wait = SLEEP_SECONDS - (time.monotonic() - _last_request)
    if wait > 0:
        time.sleep(wait)
    resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=300)
    _last_request = time.monotonic()
    resp.raise_for_status()
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_bytes(resp.content)
    return resp.content
