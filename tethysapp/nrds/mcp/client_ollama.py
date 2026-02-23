#!/usr/bin/env python3
import asyncio
import json
import os
import re
from typing import Dict, Any, List, Optional

import ollama
from fastmcp import Client as MCPClient
from fastmcp.client.transports import SSETransport

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
# SQL-only model (does NOT support tools); used only to generate SQL text.
OLLAMA_SQL_MODEL = os.getenv("OLLAMA_SQL_MODEL", "duckdb-nsql")

# Parquet + NetCDF (T-route) columns are treated the same for SQL generation
DATA_SCHEMA = """(
  time TIMESTAMP_NS,
  feature_id BIGINT,
  type VARCHAR,
  flow FLOAT,
  velocity FLOAT,
  depth FLOAT,
  nudge FLOAT
)"""

MCP_SERVER_URL = os.getenv("MCP_SERVER_URL", "http://127.0.0.1:9000/sse")
MAX_TOOL_REPAIR_ATTEMPTS = int(os.getenv("MCP_TOOL_REPAIR_ATTEMPTS", "1"))

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
    # strip common trailing punctuation
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
        {
            "role": "system",
            "content": (
                "You write DuckDB SQL only. Do NOT call tools.\n"
                "Assume a DuckDB temp view named `output` exists with schema:\n"
                f"{DATA_SCHEMA}\n"
                "Return ONLY a single SQL query (no prose, no JSON, no markdown)."
            ),
        },
        {"role": "user", "content": user_text},
    ]
    resp = ollama.chat(model=OLLAMA_SQL_MODEL, messages=sql_messages, stream=False)
    return (resp.get("message", {}).get("content") or "").strip()


def mcp_client() -> MCPClient:
    url = MCP_SERVER_URL.rstrip("/")
    if not url.endswith("/sse"):
        url += "/sse"
    return MCPClient(SSETransport(url=url))


# Step 1: Discover available tools from MCP server
async def load_mcp_tools():
    """Connect to MCP server and get list of available tools"""
    async with mcp_client() as mcp:
        tools_list = await mcp.list_tools()

        # Convert to format Ollama understands
        ollama_tools = []
        for tool in tools_list:
            ollama_tools.append(
                {
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.inputSchema,
                    },
                }
            )
        return ollama_tools


# Step 2: Execute a tool when AI requests it
async def execute_tool(tool_name: str, arguments: dict):
    """Call a tool on the MCP server with given arguments"""
    try:
        async with mcp_client() as mcp:
            result = await mcp.call_tool(tool_name, arguments, raise_on_error=False)
            if getattr(result, "is_error", False):
                msg = None
                try:
                    msg = result.content[0].text
                except Exception:
                    pass
                return {"error": msg or f"{tool_name} failed"}
            return result.data if hasattr(result, "data") else result
    except Exception as e:
        return {"error": str(e)}


def extract_inline_tool_calls(text: str) -> List[Dict[str, Any]]:
    """
    Fallback: some models return tool calls in plain text like:
      {"name": "...", "parameters": {...}}
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
        args = obj.get("parameters") or obj.get("arguments") or obj.get("params")

        if isinstance(name, str) and name and (isinstance(args, dict) or isinstance(args, str)):
            return [{"function": {"name": name, "arguments": args}}]

    return []


async def process_tool_calls(tool_calls, messages):
    """
    Execute tool calls, append tool results to messages.
    Returns: (had_error: bool, last_error_text: str|None)
    """
    had_error = False
    last_err = None

    for tool_call in tool_calls:
        tool_name = tool_call["function"]["name"]
        args = tool_call["function"]["arguments"]

        if isinstance(args, str):
            try:
                args = json.loads(args)
            except Exception:
                args = {"_raw": args}

        print(f"🔧 Tool requested: {tool_name}")
        print(f"📝 Arguments: {args}")

        tool_result = await execute_tool(tool_name, args)
        print(f"✅ Tool result: {tool_result}\n")

        messages.append(
            {
                "role": "tool",
                "tool_name": tool_name,
                "content": json.dumps(tool_result)
                if isinstance(tool_result, (dict, list))
                else str(tool_result),
            }
        )

        if isinstance(tool_result, dict) and tool_result.get("error"):
            had_error = True
            last_err = str(tool_result["error"])

    return had_error, last_err


SYSTEM_MSG = {
    "role": "system",
    "content": (
        "You may call tools.\n\n"
        "Tool calling rules:\n"
        "1) Only call tools using tool_calls (never plain text).\n"
        "2) Use ONLY argument keys defined in the tool's JSON schema. Do NOT add extra keys.\n"
        "3) Include ALL required arguments from the tool schema.\n"
        "4) Never invent IDs/values for model/forecast/cycle/vpu. If not certain, call the corresponding list_* tool first.\n"
        "5) Convert relative dates (today/yesterday/tomorrow) into an absolute date string in YYYY-MM-DD before calling tools.\n"
        "6) For ordinal user intents (e.g., \"first cycle\", \"second cycle\", \"VPU 2\"), call the relevant list_* tool and choose by ordering or matching (e.g., VPU_02).\n"
        "7) If the user provides a relative date (today/yesterday), you MUST convert to ISO and then confirm it exists by calling list_available_dates(model, start=..., end=...). Never guess a date.\n"
        "8) If forecast is short_range,use list_available_outputs_files_short_range, if medium_range, use list_available_outputs_files_medium_range. If analysis_assim_extend, use list_available_outputs_files_analysis_assim_extend.\n\n"
        "Query tools (DuckDB):\n"
        "- For Parquet: use query_parquet_output_file (args: s3_url, query). Do NOT use s3_urls/type.\n"
        "- For NetCDF: use query_netcdf_output_file (args: s3_url, query). Do NOT use s3_urls/type.\n"
        "- For NetCDF timeseries: use query_netcdf_output_file_timeseries only if you truly have multiple URLs; otherwise use query_netcdf_output_file.\n"
        "- SQL queries should read FROM output.\n\n"
        "Data schema for SQL generation:\n"
        f"{DATA_SCHEMA}\n"
    ),
}


async def main():
    print("🔍 Loading MCP tools...")
    try:
        tools = await load_mcp_tools()
    except Exception as e:
        print(f"❌ ERROR connecting to MCP server: {e}")
        print("Fix the MCP server and run again.")
        return

    print(f"✅ Loaded {len(tools)} tools:")
    for tool in tools:
        print(f"   - {tool['function']['name']}: {tool['function']['description']}")
    print("\nType ':q' to quit.\n")

    messages = [SYSTEM_MSG]

    while True:
        user_msg = input("👤 User> ").strip()
        if not user_msg:
            continue
        if user_msg in (":q", ":quit", "quit", "exit"):
            break

        messages.append({"role": "user", "content": user_msg})

        # Minimal hint: detect the file URL and tell the model EXACTLY which tool+args to use.
        file_url = extract_file_url(user_msg)
        kind = file_kind(file_url or "")
        if file_url and kind == "parquet":
            messages.append(
                {
                    "role": "user",
                    "content": (
                        f"Detected file URL: {file_url} (parquet). "
                        "Use tool query_parquet_output_file with args: s3_url=<that url>, query=<SQL>. "
                        "Do NOT use s3_urls or type."
                    ),
                }
            )
        elif file_url and kind == "netcdf":
            messages.append(
                {
                    "role": "user",
                    "content": (
                        f"Detected file URL: {file_url} (netcdf). "
                        "Use tool query_netcdf_output_file with args: s3_url=<that url>, query=<SQL>. "
                        "Do NOT use s3_urls or type."
                    ),
                }
            )

        # If this looks like a SQL query request, generate SQL text (no tools) and pass it along.
        if should_generate_sql(messages):
            try:
                sql = generate_duckdb_sql(user_msg)
            except Exception as e:
                sql = ""
                print(f"⚠️ SQL model failed: {e}")

            if sql:
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "Use this DuckDB SQL (read-only) when calling the query tool. "
                            "SQL should read FROM output:\n"
                            f"{sql}"
                        ),
                    }
                )

        while True:
            try:
                response = ollama.chat(
                    model=OLLAMA_MODEL,  # tool-capable model
                    messages=messages,
                    think=False,
                    tools=tools,
                    stream=False,
                )
            except Exception as e:
                print(f"❌ ERROR calling Ollama: {e}")
                break

            msg = response.get("message", {})
            tool_calls = msg.get("tool_calls") or []

            if not tool_calls:
                print("🔍 Checking for inline tool calls in text...")
                tool_calls = extract_inline_tool_calls(msg.get("content", "")) or []

            if not tool_calls:
                print("🤖 Assistant response (no tools requested):")
                assistant_text = msg.get("content", "")
                print(f"\n🤖 Assistant:\n{assistant_text}\n")
                messages.append({"role": "assistant", "content": assistant_text})
                break

            if "tool_calls" not in msg:
                msg["tool_calls"] = tool_calls
            messages.append(msg)

            had_error, last_err = await process_tool_calls(tool_calls, messages)

            if had_error and last_err:
                for attempt in range(1, MAX_TOOL_REPAIR_ATTEMPTS + 1):
                    print(f"⚠️ Tool call had error: {last_err}")
                    print(f"🔧 Attempting auto-repair {attempt}/{MAX_TOOL_REPAIR_ATTEMPTS}")

                    messages.append(
                        {
                            "role": "user",
                            "content": f"""Auto-repair attempt {attempt}/{MAX_TOOL_REPAIR_ATTEMPTS}.
Previous tool call failed with:
{last_err}

Fix rules:
- Use only schema keys. DO NOT pass s3_urls or type unless the tool schema says so.
- For Parquet query: tool=query_parquet_output_file, args=(s3_url, query).
- For NetCDF query: tool=query_netcdf_output_file, args=(s3_url, query).
- Reuse the exact file URL from the user's message if present.
- SQL should read FROM output.

Now: return a real tool_call with correct args.""",
                        }
                    )

                    try:
                        repair_resp = ollama.chat(
                            model=OLLAMA_MODEL,
                            messages=messages,
                            think=False,
                            tools=tools,
                            stream=False,
                        )
                    except Exception as e:
                        last_err = f"Ollama error during repair: {e}"
                        continue

                    repair_msg = repair_resp.get("message", {})
                    repair_calls = repair_msg.get("tool_calls") or []

                    if not repair_calls:
                        repair_calls = extract_inline_tool_calls(repair_msg.get("content", "")) or []

                    if not repair_calls:
                        last_err = "Model did not return tool_calls; it responded with text instead."
                        continue

                    if "tool_calls" not in repair_msg:
                        repair_msg["tool_calls"] = repair_calls
                    messages.append(repair_msg)

                    had_error, last_err = await process_tool_calls(repair_calls, messages)

                    if not had_error:
                        break

                continue

            continue

    print("👋 Bye!")


if __name__ == "__main__":
    asyncio.run(main())