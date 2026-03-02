from typing import Optional, List, Dict, Any
import re
import json
import ollama
import os
from .messages import DUCKDB_SQL_SYSTEM_MSG, AUTO_FIX_SYSTEM_MSG, FILE_MSG, DUCK_DB_ROLE_MSG


# SQL-only model (does NOT support tools); used only to generate SQL text.
OLLAMA_SQL_MODEL = os.getenv("OLLAMA_SQL_MODEL", "duckdb-nsql")


SQL_HINTS = (
    # parquet
    "parquet", "read_parquet",
    "query-output-parquet", "query_output_parquet", "query_parquet_output",
    "query-output-parquet-timeseries", "query_output_parquet_timeseries",
    # netcdf
    "netcdf", ".nc", ".nc4", "read_netcdf",
    "query-output-netcdf-file", "query-output-netcdf-timeseries",
    "query_netcdf_output_file", "query_netcdf_output_file_timeseries",
    # general
    "duckdb", "sql", "select ", "with ",
)

URL_RE = re.compile(r"(https?://\S+|s3://\S+)", re.IGNORECASE)

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
    if u.endswith(".nc") or u.endswith(".nc4") or u.endswith(".netcdf"):
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
    resp = ollama.chat(model=OLLAMA_SQL_MODEL, messages=sql_messages, stream=False)
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
    """
    Minimal normalization for common LLM mistakes:
      - {"args": "[url, query]"} -> {"s3_url": url, "query": query}
      - {"s3_url": "[url]"} for single-file tools -> {"s3_url": url}
      - drop unexpected "type" for single-file query tools
    """
    if not isinstance(args, dict):
        return args

    # ✅ Drop null/empty placeholders the LLM likes to emit
    # - JSON null becomes None after json.loads()
    # - Sometimes models emit "_" or "null"/"" strings
    for k in list(args.keys()):
        v = args.get(k)

        # common junk key
        if k == "_":
            args.pop(k, None)
            continue

        if v is None:
            args.pop(k, None)
            continue

        if isinstance(v, str) and v.strip().lower() in {"", "null", "none"}:
            args.pop(k, None)
            continue

    # --- keep your existing logic below ---
    single_file_tools = {"query_parquet_output_file", "query_netcdf_output_file"}
    if tool_name not in single_file_tools:
        return args

    # Drop common hallucinated keys
    if "type" in args and "s3_url" in args:
        args.pop("type", None)

    # Handle {"args": ...}
    if "args" in args and ("s3_url" not in args or "query" not in args):
        a = args.get("args")
        if isinstance(a, str):
            try:
                a = json.loads(a)
            except Exception:
                pass
        if isinstance(a, dict):
            # if it already has s3_url/query, use it
            if "s3_url" in a or "query" in a:
                merged = dict(args)
                merged.pop("args", None)
                merged.update(a)
                args = merged
        elif isinstance(a, list) and len(a) >= 2:
            args = {"s3_url": a[0], "query": a[1]}

    # Handle mistaken s3_urls for single-file tools
    if "s3_url" not in args and "s3_urls" in args:
        s = args.get("s3_urls")
        url = None
        if isinstance(s, str):
            url = extract_file_url(s)
        elif isinstance(s, list) and s:
            url = str(s[0])
        if url:
            args["s3_url"] = url
        args.pop("s3_url", None)

    # Drop "type" if still present (these tools don't accept it)
    args.pop("type", None)

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