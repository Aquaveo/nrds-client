#!/usr/bin/env python3
import asyncio
import json
import os
import ollama
from fastmcp import Client as MCPClient
from fastmcp.client.transports import SSETransport
from .client_utils import (
    extract_file_url,
    file_kind,
    extract_inline_tool_calls,
    should_generate_sql,
    generate_duckdb_sql,
    _normalize_query_tool_args,
    generate_auto_fix_tool_msg,
    generate_file_msg,
    generate_duckdb_role_msg,
    _rewrite_from_to_full_s3_path,
    _maybe_join_dir_and_filename,
    _parse_resolve_args,
    _is_plausible_outputs_file,
    _extract_resolved_path,
    _last_user_text,
    _get_message,
)
from .context import _print_context_usage, _compact_tool_result_for_context
from .messages import SYSTEM_MSG

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
MCP_SERVER_URL = os.getenv("MCP_SERVER_URL", "http://127.0.0.1:9000/sse")
MAX_TOOL_REPAIR_ATTEMPTS = int(os.getenv("MCP_TOOL_REPAIR_ATTEMPTS", "0"))


# Client
def mcp_client() -> MCPClient:
    url = MCP_SERVER_URL.rstrip("/")
    if not url.endswith("/sse"):
        url += "/sse"
    return MCPClient(SSETransport(url=url))

# Loading the MCP tools
async def load_mcp_tools():
    async with mcp_client() as mcp:
        tools_list = await mcp.list_tools()
        ollama_tools = []
        for tool in tools_list:
            schema = tool.inputSchema
            if hasattr(schema, "model_dump"):
                schema = schema.model_dump()
            ollama_tools.append(
                {
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": schema,
                    },
                }
            )
        return ollama_tools

async def execute_tool(tool_name: str, arguments: dict):
    try:
        async with mcp_client() as mcp:
            result = await mcp.call_tool(tool_name, arguments, raise_on_error=False)
            data = getattr(result, "data", None)
            if data is not None:
                return data
            try:
                return result.content[0].text
            except Exception:
                return result
    except Exception as e:
        return {"error": str(e)}

async def process_tool_calls(tool_calls, messages):
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

        args = _normalize_query_tool_args(tool_name, args)

        # Swap wrong query tool based on extension
        s3_url = args.get("s3_url")
        if isinstance(s3_url, str):
            if s3_url.lower().endswith(".parquet") and tool_name == "query_netcdf_output_file":
                tool_name = "query_parquet_output_file"
            if s3_url.lower().endswith((".nc", ".nc4")) and tool_name == "query_parquet_output_file":
                tool_name = "query_netcdf_output_file"

        # --- Auto-chain: resolve_output_file -> query_parquet_output_file when user requests ordinal output file ---
        user_text = _last_user_text(messages)
        ut = user_text.lower()

        if tool_name == "query_parquet_output_file" and ("output file" in ut):
            # If model didn't provide a plausible full outputs parquet path, resolve it deterministically
            current_s3 = args.get("s3_url", "")
            if not _is_plausible_outputs_file(current_s3):
                resolve_args = _parse_resolve_args(user_text)
                if resolve_args:
                    print("🔁 Auto-chaining: resolve_output_file → query_parquet_output_file")
                    resolved = await execute_tool("resolve_output_file", resolve_args)
                    resolved_path = _extract_resolved_path(resolved)
                    if resolved_path:
                        args["s3_url"] = resolved_path

        # --- Minimal fix: ensure query uses full file path in FROM (if your backend expects file path in SQL) ---
        if tool_name == "query_parquet_output_file":
            s3_url = args.get("s3_url")
            q = args.get("query")

            if isinstance(s3_url, str) and isinstance(q, str):
                # if s3_url is a directory but query mentions filename, build full path
                fixed_s3 = _maybe_join_dir_and_filename(s3_url, q)
                args["s3_url"] = fixed_s3

                # rewrite FROM <filename/output> -> FROM '<full_s3_path>'
                args["query"] = _rewrite_from_to_full_s3_path(q, fixed_s3)

        print(f"🔧 Tool requested: {tool_name}")
        print(f"📝 Arguments: {args}")

        tool_result = await execute_tool(tool_name, args)
        tool_result_for_context = _compact_tool_result_for_context(tool_result)
        print(f"✅ Tool result: {tool_result_for_context}\n")

        messages.append(
            {
                "role": "tool",
                "tool_name": tool_name,
                "content": json.dumps(tool_result_for_context)
                if isinstance(tool_result_for_context, (dict, list))
                else str(tool_result_for_context),
            }
        )

        print(f"🔄 Updated messages with tool result. Total messages: {len(messages)}")

        if isinstance(tool_result, dict) and tool_result.get("error"):
            had_error = True
            last_err = str(tool_result["error"])

    return had_error, last_err


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

        file_url = extract_file_url(user_msg)
        kind = file_kind(file_url or "")

        # Strong, explicit guidance to prevent wrong tool + wrong args
        if file_url:
            msg = generate_file_msg(file_url, kind)
            messages.append(msg)
        # Generate SQL if it looks like a SQL request OR if the user gave a data file URL
        if should_generate_sql(messages) or (file_url and kind in {"parquet", "netcdf"}):
            try:
                sql = generate_duckdb_sql(user_msg)
            except Exception as e:
                sql = ""
                print(f"⚠️ SQL model failed: {e}")

            if sql:
                msg = generate_duckdb_role_msg(sql)
                messages.append(msg)

        while True:
            try:
                response = ollama.chat(
                    model=OLLAMA_MODEL,
                    messages=messages,
                    think=False,
                    tools=tools,
                    stream=False,
                    options={"temperature": 0}
                )
                _print_context_usage(response, OLLAMA_MODEL)
            except Exception as e:
                print(f"❌ ERROR calling Ollama: {e}")
                break
            msg = _get_message(response)
            tool_calls = msg.get("tool_calls") or []

            if not tool_calls:
                assistant_content = msg.get("content", "") or ""
                if "{" in assistant_content:
                    print("🔍 Checking for inline tool calls in text...")
                tool_calls = extract_inline_tool_calls(assistant_content) or []

            if not tool_calls:
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

                    messages.append(generate_auto_fix_tool_msg(last_err))

                    try:
                        repair_resp = ollama.chat(
                            model=OLLAMA_MODEL,
                            messages=messages,
                            think=False,
                            tools=tools,
                            stream=False,
                            options={"temperature": 0} 
                        )
                        _print_context_usage(repair_resp, OLLAMA_MODEL)
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
