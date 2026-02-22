import requests
import os
import re
from urllib.parse import urlencode
from typing import Dict, Any, Optional
from datetime import datetime, date
from zoneinfo import ZoneInfo

ENDPOINTS = {
    "list_available_models": "list-available-models",
    "list_available_dates": "list-available-dates",
    "list_available_forecasts": "list-available-forecasts",
    "list_available_cycles": "list-available-cycles",
    "list_available_vpus": "list-available-vpus",
    "list_available_outputs_files": "list-available-outputs-files",
    "read_netcdf_output_file": "read-output-netcdf-file",
    "read_parquet_output_file": "read-output-parquet-file",
    "query_parquet_output_file":"query-output-parquet-file",
    "query_parquet_output_timeseries": "query-output-parquet-timeseries"
}

NRDS_API_TOKEN = os.getenv("NRDS_API_TOKEN", "be5f936afa81436a43a116546f8c8f1ad2a86079")

REST_API_HOST = os.getenv("NRDS_API_HOST", "http://localhost:8000/apps/nrds/api").rstrip("/")

def _headers() -> Dict[str, str]:
    """
        Headers for REST API requests, including auth if token is set.
    """
    h = {"Accept": "application/json"}
    if NRDS_API_TOKEN:
        h["Authorization"] = f"Token {NRDS_API_TOKEN}"
    return h

def _is_html_response(resp: requests.Response) -> bool:
    """
        Heuristic to determine if a response is HTML (e.g., an error page) rather than JSON.
        Checks Content-Type header and also looks for HTML tags in the text.
    """
    ctype = (resp.headers.get("Content-Type") or "").lower()
    if "text/html" in ctype:
        return True
    # some servers mislabel html; quick heuristic
    text = (resp.text or "").lstrip()
    return text.startswith("<!DOCTYPE html") or text.startswith("<html")


def _get_json_raw(endpoint_key: str, params: Optional[Dict[str, Any]] = None, timeout: int = 20) -> Dict[str, Any]:
    """
        Make a GET request to the specified endpoint and return the raw JSON payload as a dict.
        Tries both with and without a trailing slash to be robust against misconfigurations.
        Raises RuntimeError with details if all attempts fail.
    """
    ep = ENDPOINTS[endpoint_key].lstrip("/")
    base_url = f"{REST_API_HOST}/{ep}"
    urls_to_try = [base_url, base_url + "/"]

    last_err: Optional[str] = None
    for url in urls_to_try:
        try:
            resp = requests.get(url, params=params or {}, headers=_headers(), timeout=timeout)
            if resp.status_code == 404:
                last_err = f"404 at {url}"
                continue
            resp.raise_for_status()

            if _is_html_response(resp):
                snippet = (resp.text or "")[:300]
                raise RuntimeError(f"Expected JSON but got HTML from {url}. Snippet: {snippet}")
            payload = resp.json()

            if not isinstance(payload, dict):
                raise RuntimeError(f"Expected JSON object from {url} but got: {payload}")
            return payload
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"

    q = f"?{urlencode(params or {})}" if params else ""
    raise RuntimeError(f"NRDS API request failed for '{endpoint_key}' ({base_url}{q}). Last error: {last_err}")

def _as_id(value: str) -> str:
    """
    Convert labels to ids for known patterns:
      - forecasts: "short range" -> "short_range"
      - vpu: "VPU 14" -> "VPU_14"
    If already an id, returns unchanged.
    """
    if value is None:
        return value
    s = str(value).strip()
    
    return s.replace(" ", "_")


def _prefer_id_objects(payload: Dict[str, Any], key: str) -> None | Dict[str, Any]:
    """
    Ensure the payload always includes a list of {id,label} objects under `key`,
    plus *_ids and *_labels arrays for convenience, even if API returns legacy.
    """
    items = payload.get(key)

    if isinstance(items, list) and items and isinstance(items[0], dict) and "id" in items[0]:
        ids = [x.get("id") for x in items]
        labels = [x.get("label", x.get("id")) for x in items]
        payload[f"{key[:-1]}_ids" if key.endswith("s") else f"{key}_ids"] = ids
        payload[f"{key[:-1]}_labels" if key.endswith("s") else f"{key}_labels"] = labels
        return payload
    return None
            
DATE_PATTERN = r"^(?:\d{4}-\d{2}-\d{2}|\d{4}/\d{2}/\d{2})$"
DEFAULT_START = "2025-08-01"
DEFAULT_TZ = ZoneInfo("America/Denver")


def _parse_iso_date(s: str) -> date:
    s = s.strip().replace("/", "-")
    return datetime.strptime(s, "%Y-%m-%d").date()


def _date_from_item(d: dict) -> Optional[date]:
    """
    Accepts items shaped like:
      {id:"ngen.YYYYMMDD", label:"YYYY-MM-DD"} or similar.
    """
    label = str(d.get("label") or "")
    if re.match(r"^\d{4}-\d{2}-\d{2}$", label):
        try:
            return _parse_iso_date(label)
        except Exception:
            return None

    did = str(d.get("id") or "")
    m = re.search(r"(\d{8})", did)
    if m:
        try:
            return datetime.strptime(m.group(1), "%Y%m%d").date()
        except Exception:
            return None

    return None