from typing import Optional, List, Dict, Any, get_args
import re
import json
import ollama
import os
from .messages import DUCKDB_SQL_SYSTEM_MSG, AUTO_FIX_SYSTEM_MSG, FILE_MSG, DUCK_DB_ROLE_MSG
from ..mcp.validations import (
    FORECASTS,
    VPUS,
    MODELS,
    MEDIUM_RANGE_CYCLES,
    SHORT_RANGE_CYCLES,
    ANALYSIS_ASSIM_EXTEND_CYCLES,
)


# SQL-only model (does NOT support tools); used only to generate SQL text.
OLLAMA_SQL_MODEL = os.getenv("OLLAMA_SQL_MODEL", "duckdb-nsql")


SQL_HINTS = (
    # parquet
    "parquet", "read_parquet",
    "query-output-parquet", "query_output_parquet", "query_parquet_output",
    # "query-output-parquet-timeseries", "query_output_parquet_timeseries",
    # netcdf
    "netcdf", ".nc", ".nc4", "read_netcdf",
    "query-output-netcdf-file", "query_netcdf_output_file",
    # "query-output-netcdf-file", "query-output-netcdf-timeseries",
    
    # general
    "duckdb", "sql", "select ", "with ",
)

URL_RE = re.compile(r"(https?://\S+|s3://\S+)", re.IGNORECASE)

# matches filenames like troute_output_YYYYMMDDHHMM.parquet
_PARQUET_NAME_RE = re.compile(r"\b([A-Za-z0-9._-]+\.parquet)\b", re.IGNORECASE)

# capture the first FROM target token (simple queries)
_FROM_TARGET_RE = re.compile(r"(?is)\bfrom\s+([^\s;]+)")



_ORDINALS = {
    "first": 0, "1st": 0,
    "second": 1, "2nd": 1,
    "third": 2, "3rd": 2,
    "fourth": 3, "4th": 3,
    "fifth": 4, "5th": 4,
    "sixth": 5, "6th": 5,
    "seventh": 6, "7th": 6,
    "eighth": 7, "8th": 7,
    "ninth": 8, "9th": 8,
    "tenth": 9, "10th": 9,
}

_DATE_RE = re.compile(r"\b(\d{4}[-/]\d{2}[-/]\d{2})\b")
_CYCLE_RE = re.compile(r"\bcycle\s*([01]\d|2[0-3])\b", re.IGNORECASE)
_VPU_RE = re.compile(r"\bvpu\s*([0-9]{1,2})\b", re.IGNORECASE)
_MODEL_RE = re.compile(r"\bmodel\s+([a-z0-9_ ]+)\b", re.IGNORECASE)

_VALID_FORECASTS = set(get_args(FORECASTS))
_VALID_VPUS = set(get_args(VPUS))
_VALID_MODELS = set(get_args(MODELS))
_VALID_CYCLES_BY_FORECAST = {
    "short_range": set(get_args(SHORT_RANGE_CYCLES)),
    "medium_range": set(get_args(MEDIUM_RANGE_CYCLES)),
    "analysis_assim_extend": set(get_args(ANALYSIS_ASSIM_EXTEND_CYCLES)),
}

def _last_user_text(messages) -> str:
    for m in reversed(messages):
        if m.get("role") == "user":
            return str(m.get("content") or "")
    return ""

def _is_plausible_outputs_file(u: str) -> bool:
    if not isinstance(u, str):
        return False
    ul = u.lower()
    return (ul.startswith(("s3://", "https://")) and "/outputs/" in ul and ul.endswith(".parquet") or ul.endswith(".nc"))

def _parse_forecast(user_text: str) -> str:
    t = user_text.lower()
    if "medium range" in t or "medium_range" in t:
        return "medium_range"
    if "short range" in t or "short_range" in t:
        return "short_range"
    if "analysis assim" in t or "analysis_assim_extend" in t:
        return "analysis_assim_extend"
    # default consistent with your tools
    return "short_range"

def _parse_resolve_args(user_text: str) -> dict | None:
    t = user_text.lower()

    # selector (index)
    index = None
    for k, v in _ORDINALS.items():
        if k in t:
            index = v
            break

    # if user didn't refer to an ordinal, don't auto-chain
    if index is None and "output file" in t:
        # "the output file" without ordinal is ambiguous; don't guess
        return None

    # model
    model = None
    m = _MODEL_RE.search(t)
    if m:
        model = m.group(1).strip()
        # stop at common separators
        for stop in [" for ", " on ", " vpu", " cycle", " forecast", " today"]:
            model = model.split(stop)[0].strip()
        model = model.replace(" ", "_")
        if model not in _VALID_MODELS:
            model = None

    # cycle
    cycle = None
    m = _CYCLE_RE.search(t)
    if m:
        cycle = m.group(1).zfill(2)

    # vpu
    vpu = None
    m = re.search(r"\bvpu(?:[_\s-]*)(\d{1,2})([a-z]?)\b", t, re.IGNORECASE)
    if m:
        suffix = (m.group(2) or "").upper()
        candidate = f"VPU_{int(m.group(1)):02d}{suffix}"
        if candidate in _VALID_VPUS:
            vpu = candidate

    # date
    date = None
    m = _DATE_RE.search(t)
    if m:
        date = m.group(1)
    elif "today" in t:
        date = None  # let server default

    forecast = _parse_forecast(t)
    if forecast not in _VALID_FORECASTS:
        return None

    if not model or not cycle or not vpu:
        return None
    valid_cycles = _VALID_CYCLES_BY_FORECAST.get(forecast, set())
    if cycle not in valid_cycles:
        return None

    args = {
        "model": model,
        "forecast": forecast,
        "cycle": cycle,
        "vpu": vpu,
        "index": index if index is not None else 0,
    }
    if date is not None:
        args["date"] = date

    # medium_range needs ensemble=1 in your layout; send it explicitly
    if forecast == "medium_range":
        args["ensemble"] = "1"

    return args

def _extract_resolved_path(resolve_payload) -> str | None:
    # be permissive: support a few possible payload shapes
    if isinstance(resolve_payload, dict):
        if isinstance(resolve_payload.get("selected"), dict):
            p = resolve_payload["selected"].get("path")
            if isinstance(p, str):
                return p
        p = resolve_payload.get("path")
        if isinstance(p, str) and p.lower().endswith(".parquet"):
            return p
        if isinstance(resolve_payload.get("file"), dict):
            p = resolve_payload["file"].get("path")
            if isinstance(p, str):
                return p
    return None


def _maybe_join_dir_and_filename(s3_url: str, query: str) -> str:
    """
    If the model put a directory in s3_url and a filename in the SQL,
    join them to produce a full file path.
    """
    if not isinstance(s3_url, str) or not isinstance(query, str):
        return s3_url
    if s3_url.lower().endswith(".parquet"):
        return s3_url
    if s3_url.endswith("/"):
        m = _PARQUET_NAME_RE.search(query)
        if m:
            return s3_url.rstrip("/") + "/" + m.group(1)
    return s3_url

def _rewrite_from_to_full_s3_path(query: str, s3_url: str) -> str:
    """
    Rewrite:
      SELECT ... FROM troute_output_....parquet
    into:
      SELECT ... FROM 's3://.../troute_output_....parquet'
    Uses the tool arg s3_url as the canonical path.
    """
    if not isinstance(query, str) or not query.strip():
        return query
    if not isinstance(s3_url, str) or not s3_url.strip():
        return query

    # If the query already contains the full s3_url, leave it
    if s3_url in query:
        return query

    m = _FROM_TARGET_RE.search(query)
    if not m:
        return query

    target = m.group(1).strip()

    # Don't touch function calls like read_parquet(...)
    if target.lower().startswith(("read_parquet", "parquet_scan", "read_csv", "read_json")):
        return query

    # Replace if it's clearly not a full path (bare filename or "output")
    is_bare_file = target.lower().endswith(".parquet") and "://" not in target and "/" not in target
    is_output = target.lower() == "output"

    if is_bare_file or is_output:
        return _FROM_TARGET_RE.sub(f"FROM '{s3_url}'", query, count=1)

    return query

def extract_file_url(text: str) -> Optional[str]:
    m = URL_RE.search(text or "")
    if not m:
        return None
    return m.group(1).rstrip(").,;]}>\"'")


def file_kind(url: str) -> Optional[str]:
    if not url:
        return None
    u = url.lower()
    if u.endswith(".parquet"):
        return "parquet"
    if u.endswith(".nc"):
        return "netcdf"
    return None


def _last_user_text(messages) -> str:
    for m in reversed(messages):
        if m.get("role") == "user":
            return str(m.get("content", ""))
    return ""


def should_generate_sql(messages, tool_calls=None, last_err=None) -> bool:
    blob = " ".join(
        [
            _last_user_text(messages),
            json.dumps(tool_calls or []),
            str(last_err or ""),
        ]
    ).lower()
    return any(h in blob for h in SQL_HINTS)


def generate_duckdb_sql(user_text: str) -> str:
    """
    Use the SQL-only model to generate a DuckDB query.
    IMPORTANT: This model does not support tools, so we never pass tools=...
    """
    sql_messages = [
        DUCKDB_SQL_SYSTEM_MSG,
        {"role": "user", "content": user_text},
    ]
    resp = ollama.chat(model=OLLAMA_SQL_MODEL, messages=sql_messages, stream=False, options={"temperature": 0.0})
    return (resp.get("message", {}).get("content") or "").strip()

def extract_inline_tool_calls(text: str) -> List[Dict[str, Any]]:
    """
    Fallback: some models return tool calls in plain text like:
      {"name": "...", "parameters": {...}} or {"name": "...", "args": {...}}
    Convert to Ollama-like tool_calls structure:
      [{"function":{"name": "...", "arguments": {...}}}]
    """
    if not text:
        return []

    decoder = json.JSONDecoder()
    for i, ch in enumerate(text):
        if ch != "{":
            continue
        try:
            obj, _ = decoder.raw_decode(text[i:])
        except Exception:
            continue

        if not isinstance(obj, dict):
            continue

        name = obj.get("name") or obj.get("tool") or obj.get("tool_name")
        args = obj.get("parameters") or obj.get("arguments") or obj.get("params") or obj.get("args")

        if isinstance(name, str) and name and (isinstance(args, dict) or isinstance(args, str)):
            return [{"function": {"name": name, "arguments": args}}]

    return []


def _normalize_query_tool_args(tool_name: str, args: Any) -> Any:
    if not isinstance(args, dict):
        return args

    # Tools we want to strictly sanitize
    query_tools = {"query_parquet_output_file", "query_netcdf_output_file"}
    read_tools = {"read_parquet_output_file", "read_netcdf_output_file"}

    # ---- query tools: keep ONLY (s3_url, query), and try to repair folder+filename ----
    if tool_name in query_tools:
        # If model passed folder path + files_names, combine to full file URL
        s3_url = args.get("s3_url")
        fname = args.get("files_names") or args.get("file_name") or args.get("filename")
        if isinstance(s3_url, str) and fname and not s3_url.lower().endswith((".parquet", ".nc", ".nc4")):
            args["s3_url"] = s3_url.rstrip("/") + "/" + str(fname).lstrip("/")

        # Drop everything except schema keys
        args = {k: args[k] for k in ("s3_url", "query") if k in args}
        return args

    # ---- read tools: keep ONLY (s3_url) ----
    if tool_name in read_tools:
        args = {k: args[k] for k in ("s3_url",) if k in args}
        return args

    return args

def generate_auto_fix_tool_msg(last_err: str) -> Dict[str, Any]:
    return {
        "role": "user",
        "content": (
            "Previous tool call failed with:\n"
            f"{last_err}\n\n"
            f"{AUTO_FIX_SYSTEM_MSG}"
            )
    }

def generate_file_msg(file_url: str, file_type: str) -> Dict[str, Any]:
    mcp_tool_command = "Detected file URL, but could not determine file type. Please check the URL and try again. \n"
    if file_type == "netcdf":
        mcp_tool_command = "Call query_netcdf_output_file with args exactly: \n"
    elif file_type == "parquet":
        mcp_tool_command = "Call query_parquet_output_file with args exactly: \n"
    else:
        mcp_tool_command = "Detected file URL, but could not determine file type. Please check the URL and try again.\n"
    return {
        "role": "user",
        "content": (
            f"Detected file URL: {file_url} ({file_type}). \n"
            f"{mcp_tool_command}"
            f"{FILE_MSG}"
        )
    }

def generate_duckdb_role_msg(sql: str) -> Dict[str, Any]:
    return {
        "role": "user",
        "content": (
           f"{DUCK_DB_ROLE_MSG}\n"
            f"{sql}"
        ),
    }

def _get_message(resp):
    if isinstance(resp, dict):
        return resp.get("message", {}) or {}
    m = getattr(resp, "message", None)
    if m is None:
        return {}
    if isinstance(m, dict):
        return m
    if hasattr(m, "model_dump"):
        return m.model_dump()
    if hasattr(m, "dict"):
        return m.dict()
    return {
        "content": getattr(m, "content", ""),
        "tool_calls": getattr(m, "tool_calls", None),
        "thinking": getattr(m, "thinking", None),
    }
