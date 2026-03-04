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
    _normalize_query_tool_args,
    generate_auto_fix_tool_msg,
    generate_file_msg,
    _rewrite_from_to_output,
    _maybe_join_dir_and_filename,
    _is_plausible_outputs_file,
    _last_tool_file_url,
    _get_message,
)
import readline  # for better input experience (history, editing)
from .terminal import setup_readline
from .context import _print_context_usage, _compact_tool_result_for_context
from .messages import SYSTEM_MSG

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3")
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


def _tool_call_signature(tool_name: str, args: dict) -> str:
    try:
        args_blob = json.dumps(args, sort_keys=True, ensure_ascii=False)
    except Exception:
        args_blob = str(args)
    return f"{tool_name}|{args_blob}"


def _tool_error_text(tool_result) -> str | None:
    if isinstance(tool_result, dict):
        err = tool_result.get("error")
        if err:
            return str(err)

    if isinstance(tool_result, str):
        low = tool_result.lower()
        if any(
            token in low
            for token in (
                "validation error",
                "error calling tool",
                "unknown tool",
                "httperror",
                "traceback",
                "server error",
                "failed",
            )
        ):
            return tool_result

    return None


def _bump_failed_signature_counts(counts: dict[str, int], signatures: list[str]) -> str | None:
    repeated = None
    for sig in signatures:
        counts[sig] = counts.get(sig, 0) + 1
        if counts[sig] >= 2:
            repeated = sig
    return repeated


async def process_tool_calls(tool_calls, messages):
    had_error = False
    last_err = None
    failed_signatures: list[str] = []

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

        # For follow-up prompts, recover the last concrete file URL from tool history.
        if tool_name in {"query_parquet_output_file", "query_netcdf_output_file"}:
            current_s3 = args.get("s3_url", "")
            if not _is_plausible_outputs_file(current_s3):
                fallback = None
                if tool_name == "query_parquet_output_file":
                    fallback = _last_tool_file_url(messages, exts=(".parquet",))
                else:
                    fallback = _last_tool_file_url(messages, exts=(".nc", ".nc4"))
                if fallback:
                    print(f"🔁 Reusing last output file URL: {fallback}")
                    args["s3_url"] = fallback

        # --- SQL normalization for query tools ---
        if tool_name in {"query_parquet_output_file", "query_netcdf_output_file"}:
            q = args.get("query")
            if isinstance(q, str):
                args["query"] = _rewrite_from_to_output(q)

        if tool_name == "query_parquet_output_file":
            s3_url = args.get("s3_url")
            q = args.get("query")

            if isinstance(s3_url, str) and isinstance(q, str):
                # if s3_url is a directory but query mentions filename, build full path
                fixed_s3 = _maybe_join_dir_and_filename(s3_url, q)
                args["s3_url"] = fixed_s3

                # SQL should read from temp view 'output' for this backend.
                args["query"] = _rewrite_from_to_output(q)

        call_signature = _tool_call_signature(tool_name, args if isinstance(args, dict) else {"_raw": args})
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

        err_text = _tool_error_text(tool_result)
        if err_text:
            had_error = True
            last_err = err_text
            failed_signatures.append(call_signature)

    return had_error, last_err, failed_signatures


async def main():
    setup_readline()
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
        failed_sig_counts: dict[str, int] = {}

        file_url = extract_file_url(user_msg)
        kind = file_kind(file_url or "")

        # Strong, explicit guidance to prevent wrong tool + wrong args
        if file_url:
            msg = generate_file_msg(file_url, kind)
            messages.append(msg)

        while True:
            try:
                response = ollama.chat(
                    model=OLLAMA_MODEL,
                    messages=messages,
                    think=True,
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

            had_error, last_err, failed_signatures = await process_tool_calls(tool_calls, messages)

            if had_error and last_err:
                repeated_signature = _bump_failed_signature_counts(failed_sig_counts, failed_signatures)

                if MAX_TOOL_REPAIR_ATTEMPTS <= 0 and repeated_signature:
                    messages.append(
                        generate_auto_fix_tool_msg(
                            last_err,
                            prior_user_text=user_msg,
                            repeated_signature=repeated_signature,
                        )
                    )
                    continue

                for attempt in range(1, MAX_TOOL_REPAIR_ATTEMPTS + 1):
                    print(f"⚠️ Tool call had error: {last_err}")
                    print(f"🔧 Attempting auto-repair {attempt}/{MAX_TOOL_REPAIR_ATTEMPTS}")

                    messages.append(
                        generate_auto_fix_tool_msg(
                            last_err,
                            prior_user_text=user_msg,
                            repeated_signature=repeated_signature,
                        )
                    )

                    try:
                        repair_resp = ollama.chat(
                            model=OLLAMA_MODEL,
                            messages=messages,
                            think=True,
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

                    had_error, last_err, failed_signatures = await process_tool_calls(repair_calls, messages)
                    repeated_signature = _bump_failed_signature_counts(failed_sig_counts, failed_signatures)

                    if not had_error:
                        break

                continue

            continue

    print("👋 Bye!")


if __name__ == "__main__":
    asyncio.run(main())
