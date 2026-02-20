import asyncio
import json
import os
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import ollama
from fastmcp import Client
from fastmcp.client.transports import SSETransport

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
MCP_SERVER_SSE_URL = os.getenv("MCP_SERVER_URL", "http://127.0.0.1:9000/sse")


def _make_mcp_client() -> Client:
    url = MCP_SERVER_SSE_URL.rstrip("/")
    if not url.endswith("/sse"):
        url += "/sse"
    return Client(SSETransport(url=url))


async def call_tool(tool_name: str, args: Dict[str, Any]) -> Any:
    async with _make_mcp_client() as c:
        res = await c.call_tool(tool_name, args, raise_on_error=False)
        if getattr(res, "is_error", False):
            msg = None
            try:
                if res.content and hasattr(res.content[0], "text"):
                    msg = res.content[0].text
            except Exception:
                pass
            return {"error": msg or f"Tool {tool_name} failed"}
        return res.data if getattr(res, "data", None) is not None else {"result": None}


def _items(payload: Dict[str, Any], key: str) -> List[Dict[str, Any]]:
    """
    Expect payload[key] to be a list of {id,label}.
    """
    v = payload.get(key) or []
    if isinstance(v, list) and (not v or isinstance(v[0], dict)):
        return v
    # tolerate legacy list of strings
    if isinstance(v, list) and v and isinstance(v[0], str):
        return [{"id": s, "label": s} for s in v]
    return []


def _pick_first_id(payload: Dict[str, Any], key: str) -> str:
    arr = _items(payload, key)
    if not arr:
        raise RuntimeError(f"No items found for '{key}' in payload keys={list(payload.keys())}")
    return str(arr[0].get("id") or arr[0].get("label"))


def _pick_latest_date_label(dates_payload: Dict[str, Any]) -> Tuple[str, str]:
    """
    Returns (date_label_iso, date_id_folder) for the *latest* date.
    Expects dates as [{id: "ngen.YYYYMMDD", label: "YYYY-MM-DD"}, ...]
    """
    dates = _items(dates_payload, "dates")
    if not dates:
        raise RuntimeError("No dates returned")

    best = None
    best_dt = None
    for d in dates:
        label = str(d.get("label") or "")
        did = str(d.get("id") or "")
        try:
            dt = datetime.strptime(label, "%Y-%m-%d")
        except Exception:
            # fallback: try extracting YYYYMMDD from id
            m = re.search(r"(\d{8})", did)
            if m:
                dt = datetime.strptime(m.group(1), "%Y%m%d")
            else:
                continue

        if best_dt is None or dt > best_dt:
            best_dt = dt
            best = d

    if not best:
        # final fallback: just take last item
        best = dates[-1]

    return str(best.get("label") or best.get("id")), str(best.get("id") or "")


def _pick_preferred_id(payload: Dict[str, Any], key: str, preferred_ids: List[str]) -> str:
    arr = _items(payload, key)
    if not arr:
        raise RuntimeError(f"No items returned for {key}")
    # exact id match preference
    by_id = {str(x.get("id")): x for x in arr}
    for pid in preferred_ids:
        if pid in by_id:
            return pid
    # fallback: first item
    return str(arr[0].get("id") or arr[0].get("label"))


def _pick_latest_cycle_id(cycles_payload: Dict[str, Any]) -> str:
    cycles = _items(cycles_payload, "cycles")
    if not cycles:
        raise RuntimeError("No cycles returned")
    # cycles are usually "00".."23" -> pick max numeric
    def as_int(x: Dict[str, Any]) -> int:
        cid = str(x.get("id") or x.get("label") or "")
        try:
            return int(cid)
        except Exception:
            return -1
    cycles_sorted = sorted(cycles, key=as_int)
    return str((cycles_sorted[-1].get("id") or cycles_sorted[-1].get("label")))


def _extract_timestamp_from_filename(name: str) -> Optional[int]:
    """
    For names like: troute_output_202602180100.parquet
    extracts 202602180100 as int. Supports 12-14 digit timestamps.
    """
    # common: YYYYMMDDHHMM (12 digits) or YYYYMMDDHHMMSS (14)
    m = re.search(r"(\d{14}|\d{12})", name)
    if not m:
        return None
    try:
        return int(m.group(1))
    except Exception:
        return None


def _pick_newest_parquet(files: List[str]) -> Optional[str]:
    parqs = [f for f in files if f.lower().endswith(".parquet")]
    if not parqs:
        return None

    scored = []
    for f in parqs:
        ts = _extract_timestamp_from_filename(f)
        scored.append((ts if ts is not None else -1, f))

    # If any had a timestamp, pick max timestamp; else pick max lexicographically
    if any(ts != -1 for ts, _ in scored):
        scored.sort(key=lambda x: x[0])
        return scored[-1][1]
    return sorted(parqs)[-1]


async def main():
    user_msg = "Find the parquet files outputs for the latest date available for the short term forecast for VPU_14, and first cycle"
    print(f"👤 User: {user_msg}\n")

    # 1) models
    models_payload = await call_tool("list_available_models", {})
    if isinstance(models_payload, dict) and models_payload.get("error"):
        print("❌ list_available_models failed:", models_payload["error"])
        return
    model_id = _pick_first_id(models_payload, "models")

    # 2) dates -> pick latest
    dates_payload = await call_tool("list_available_dates", {"model": model_id})
    if isinstance(dates_payload, dict) and dates_payload.get("error"):
        print("❌ list_available_dates failed:", dates_payload["error"])
        return
    date_label_iso, date_id_folder = _pick_latest_date_label(dates_payload)

    # 3) forecasts -> prefer medium_range
    forecasts_payload = await call_tool("list_available_forecasts", {"model": model_id, "date": date_label_iso})
    if isinstance(forecasts_payload, dict) and forecasts_payload.get("error"):
        print("❌ list_available_forecasts failed:", forecasts_payload["error"])
        return
    forecast_id = _pick_preferred_id(
        forecasts_payload,
        "forecasts",
        preferred_ids=["medium_range", "short_range", "analysis_assim_extend"],
    )

    # 4) cycles -> pick latest
    cycles_payload = await call_tool(
        "list_available_cycles",
        {"model": model_id, "date": date_label_iso, "forecast": forecast_id},
    )
    if isinstance(cycles_payload, dict) and cycles_payload.get("error"):
        print("❌ list_available_cycles failed:", cycles_payload["error"])
        return
    cycle_id = _pick_latest_cycle_id(cycles_payload)

    # 5) vpus -> prefer VPU_14 if present
    vpus_payload = await call_tool(
        "list_available_vpus",
        {"model": model_id, "date": date_label_iso, "forecast": forecast_id, "cycle": cycle_id},
    )
    if isinstance(vpus_payload, dict) and vpus_payload.get("error"):
        print("❌ list_available_vpus failed:", vpus_payload["error"])
        return
    vpu_id = _pick_preferred_id(vpus_payload, "vpus", preferred_ids=["VPU_14"])

    # 6) outputs files
    outputs_payload = await call_tool(
        "list_available_outputs_files",
        {"model": model_id, "date": date_label_iso, "forecast": forecast_id, "cycle": cycle_id, "vpu": vpu_id},
    )
    if isinstance(outputs_payload, dict) and outputs_payload.get("error"):
        print("❌ list_available_outputs_files failed:", outputs_payload["error"])
        return

    files = outputs_payload.get("files") or []
    if not isinstance(files, list):
        files = []

    newest = _pick_newest_parquet(files)
    base_path = outputs_payload.get("path") or ""
    newest_s3 = f"{base_path.rstrip('/')}/{newest}" if newest and base_path else None

    # 7) format response with Ollama (no tools)
    summary_prompt = {
        "role": "user",
        "content": (
            "Use ONLY the provided data. Do not invent.\n\n"
            f"model_id: {model_id}\n"
            f"latest_date_label: {date_label_iso}\n"
            f"forecast_id: {forecast_id}\n"
            f"cycle_id: {cycle_id}\n"
            f"vpu_id: {vpu_id}\n"
            f"outputs_path: {base_path}\n"
            f"newest_parquet: {newest}\n"
            f"newest_parquet_s3: {newest_s3}\n\n"
            "Return a short answer with these fields."
        ),
    }

    resp = ollama.chat(model=OLLAMA_MODEL, messages=[summary_prompt], stream=False)
    print("🤖 Result:\n")
    print(resp["message"]["content"])


if __name__ == "__main__":
    asyncio.run(main())
