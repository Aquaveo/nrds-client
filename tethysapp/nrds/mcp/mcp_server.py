import os
from typing import Any, Dict, List, Optional, Union
from urllib.parse import urlencode

import requests
from fastmcp import FastMCP

# Create the MCP server instance
mcp = FastMCP("NRDS MCP Server")

# Base URL of your Tethys app REST API
REST_API_HOST = os.getenv("NRDS_API_HOST", "http://localhost:8001/apps/nrds/api").rstrip("/")

# Optional token auth
NRDS_API_TOKEN = os.getenv("NRDS_API_TOKEN", "be5f936afa81436a43a116546f8c8f1ad2a86079")

# Map tool -> endpoint path
ENDPOINTS = {
    "list_available_models": "list-available-models",
    "list_available_dates": "list-available-dates",
    "list_available_forecasts": "list-available-forecasts",
    "list_available_cycles": "list-available-cycles",
    "list_available_vpus": "list-available-vpus",
    "list_available_outputs_files": "list-available-outputs-files",
}


# -----------------------------------------------------------------------------
# HTTP helpers
# -----------------------------------------------------------------------------
def _headers() -> Dict[str, str]:
    h = {"Accept": "application/json"}
    if NRDS_API_TOKEN:
        h["Authorization"] = f"Token {NRDS_API_TOKEN}"
    return h
def _as_model_id(value: str) -> str:
    return str(value).strip()


def _is_html_response(resp: requests.Response) -> bool:
    ctype = (resp.headers.get("Content-Type") or "").lower()
    if "text/html" in ctype:
        return True
    # some servers mislabel html; quick heuristic
    text = (resp.text or "").lstrip()
    return text.startswith("<!DOCTYPE html") or text.startswith("<html")


def _get_json_raw(endpoint_key: str, params: Optional[Dict[str, Any]] = None, timeout: int = 20) -> Dict[str, Any]:
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
                # Your API should return dicts; keep it consistent
                return {"data": payload}
            return payload
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"

    q = f"?{urlencode(params or {})}" if params else ""
    raise RuntimeError(f"NRDS API request failed for '{endpoint_key}' ({base_url}{q}). Last error: {last_err}")


# -----------------------------------------------------------------------------
# ID/Label normalization helpers
# -----------------------------------------------------------------------------
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
    # Only do minimal safe normalization: spaces -> underscores
    return s.replace(" ", "_")


def _prefer_id_objects(payload: Dict[str, Any], key: str) -> Dict[str, Any]:
    """
    Ensure the payload always includes a list of {id,label} objects under `key`,
    plus *_ids and *_labels arrays for convenience, even if API returns legacy.
    """
    items = payload.get(key)

    # If already [{id,label}, ...]
    if isinstance(items, list) and items and isinstance(items[0], dict) and "id" in items[0]:
        ids = [x.get("id") for x in items]
        labels = [x.get("label", x.get("id")) for x in items]
        payload[f"{key[:-1]}_ids" if key.endswith("s") else f"{key}_ids"] = ids
        payload[f"{key[:-1]}_labels" if key.endswith("s") else f"{key}_labels"] = labels
        return payload

    # If API provided *_ids/_labels instead
    ids_key = f"{key[:-1]}_ids" if key.endswith("s") else f"{key}_ids"
    labels_key = f"{key[:-1]}_labels" if key.endswith("s") else f"{key}_labels"

    ids = payload.get(ids_key)
    labels = payload.get(labels_key)

    if isinstance(ids, list):
        if not isinstance(labels, list) or len(labels) != len(ids):
            labels = ids
        payload[key] = [{"id": i, "label": l} for i, l in zip(ids, labels)]
        return payload

    # Legacy list of strings -> treat as labels, derive ids
    if isinstance(items, list) and (not items or isinstance(items[0], str)):
        labels = items
        ids = [_as_id(x) for x in labels]
        payload[key] = [{"id": i, "label": l} for i, l in zip(ids, labels)]
        payload[ids_key] = ids
        payload[labels_key] = labels
        return payload

    return payload


# -----------------------------------------------------------------------------
# MCP tools
# -----------------------------------------------------------------------------

@mcp.tool(name="healthcheck", description="Check connectivity to the NRDS REST API host.")
def healthcheck() -> Dict[str, Any]:
    raw = _get_json_raw("list_available_models")
    raw = _prefer_id_objects(raw, "models")

    models = raw.get("models") or []
    sample_models = [m.get("id") for m in models[:5] if isinstance(m, dict)]

    return {
        "ok": True,
        "host": REST_API_HOST,
        "model_count": len(models),
        "sample_models": sample_models,
    }

@mcp.tool(name="list_available_models", description="List available NRDS models (returns id + label).")
def list_available_models_tool() -> Dict[str, Any]:
    raw = _get_json_raw("list_available_models")
    # Ensure standard format
    raw = _prefer_id_objects(raw, "models")
    return raw
@mcp.tool(
    name="list_available_dates",
    description=(
        "List available dates for a given model (returns id + label). "
        "Use offset/limit to request a subset (e.g., limit=3 for first 3)."
    ),
)
def list_available_dates_tool(
    model: str,
    offset: int = 0,
    limit: int = 0,  # 0 means 'no limit'
    # optional aliases to tolerate LLM mistakes:
    start: Optional[int] = None,
    end: Optional[int] = None,
) -> Dict[str, Any]:
    # If the model uses start/end, translate them.
    if start is not None and offset == 0:
        offset = int(start)

    if end is not None and limit == 0:
        # interpret end as an exclusive index
        limit = max(0, int(end) - offset)

    raw = _get_json_raw("list_available_dates", params={"model": model})
    raw = _prefer_id_objects(raw, "dates")

    dates = raw.get("dates") or []
    if isinstance(dates, list) and dates and isinstance(dates[0], dict):
        if offset or (limit and limit > 0):
            raw["dates"] = dates[offset : (offset + limit) if limit else None]

    return raw


@mcp.tool(name="list_available_forecasts", description="List available forecasts for a given model and date (returns id + label).")
def list_available_forecasts_tool(model: str, date: str) -> Dict[str, Any]:
    # Your API normalizes date input; pass it through
    raw = _get_json_raw("list_available_forecasts", params={"model": model, "date": date})
    raw = _prefer_id_objects(raw, "forecasts")
    return raw


@mcp.tool(name="list_available_cycles", description="List available cycles for a given model, date, and forecast (accepts id or label).")
def list_available_cycles_tool(model: str, date: str, forecast: str) -> Dict[str, Any]:
    forecast_id = _as_id(forecast)
    raw = _get_json_raw(
        "list_available_cycles",
        params={"model": model, "date": date, "forecast": forecast_id},
    )
    # cycles are already stable, but normalize to {id,label} anyway
    raw = _prefer_id_objects(raw, "cycles")
    return raw


@mcp.tool(name="list_available_vpus", description="List available VPUs for a given model, date, forecast, and cycle (returns id + label).")
def list_available_vpus_tool(model: str, date: str, forecast: str, cycle: str) -> Dict[str, Any]:
    forecast_id = _as_id(forecast)
    raw = _get_json_raw(
        "list_available_vpus",
        params={"model": model, "date": date, "forecast": forecast_id, "cycle": cycle},
    )
    raw = _prefer_id_objects(raw, "vpus")
    return raw


@mcp.tool(
    name="list_available_outputs_files",
    description="List available output files for a given model/date/forecast/cycle/vpu (accepts ids or labels).",
)
def list_available_outputs_files_tool(
    model: str,
    date: str,
    forecast: str,
    cycle: str,
    vpu: str,
    ensemble: Optional[Union[int, str]] = None,
) -> Dict[str, Any]:
    params: Dict[str, Any] = {
        "model": model,
        "date": date,
        "forecast": _as_id(forecast),
        "cycle": cycle,
        "vpu": _as_id(vpu),
    }
    if ensemble is not None:
        params["ensemble"] = ensemble

    raw = _get_json_raw("list_available_outputs_files", params=params)
    return raw


if __name__ == "__main__":
    mcp.run(transport="sse", port=9000)
