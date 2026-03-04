#!/usr/bin/env python3
import asyncio
import json
import logging
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
    _tool_error_text,
    _tool_call_signature,
)
from .terminal import setup_readline
from .context import _print_context_usage, _compact_tool_result_for_context
from .messages import SYSTEM_MSG

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3")
MCP_SERVER_URL = os.getenv("MCP_SERVER_URL", "http://127.0.0.1:9000/sse")
MAX_TOOL_REPAIR_ATTEMPTS = int(os.getenv("MCP_TOOL_REPAIR_ATTEMPTS", "0"))
OLLAMA_STREAM_THINKING = os.getenv("OLLAMA_STREAM_THINKING", "1").lower() in {"1", "true", "yes", "on"}
OLLAMA_SHOW_THINKING = os.getenv("OLLAMA_SHOW_THINKING", "1").lower() in {"1", "true", "yes", "on"}


class _DebugOnlyFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        return record.levelno == logging.DEBUG


def _configure_logger() -> logging.Logger:
    logger = logging.getLogger("nrds.client")
    if logger.handlers:
        return logger

    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(levelname)s: %(message)s"))

    debug_only = os.getenv("NRDS_LOG_DEBUG_ONLY", "0").lower() in {"1", "true", "yes", "on"}
    if debug_only:
        logger.setLevel(logging.DEBUG)
        handler.setLevel(logging.DEBUG)
        handler.addFilter(_DebugOnlyFilter())
    else:
        level_name = os.getenv("NRDS_LOG_LEVEL", "INFO").upper()
        level_value = getattr(logging, level_name, logging.INFO)
        logger.setLevel(level_value)
        handler.setLevel(level_value)

    logger.addHandler(handler)
    logger.propagate = False
    return logger


LOGGER = _configure_logger()


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


def _as_dict(obj):
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "model_dump"):
        try:
            return obj.model_dump()
        except Exception:
            pass
    if hasattr(obj, "dict"):
        try:
            return obj.dict()
        except Exception:
            pass
    return {}


def _chat_with_optional_thinking_stream(messages, tools):
    """Return a non-stream-like response dict, optionally printing streamed thinking."""
    if not OLLAMA_STREAM_THINKING:
        return ollama.chat(
            model=OLLAMA_MODEL,
            messages=messages,
            think=True,
            tools=tools,
            stream=False,
            options={"temperature": 0},
        )

    response_stream = ollama.chat(
        model=OLLAMA_MODEL,
        messages=messages,
        think=True,
        tools=tools,
        stream=True,
        options={"temperature": 0},
    )

    merged = {}
    merged_message = {"role": "assistant", "content": "", "thinking": "", "tool_calls": None}
    printed_thinking_header = False

    for chunk in response_stream:
        chunk_dict = _as_dict(chunk)
        msg = _as_dict(chunk_dict.get("message"))

        thought = msg.get("thinking")
        if isinstance(thought, str) and thought:
            merged_message["thinking"] += thought
            if OLLAMA_SHOW_THINKING:
                if not printed_thinking_header:
                    print("\n🧠 Thinking:")
                    printed_thinking_header = True
                print(thought, end="", flush=True)

        content = msg.get("content")
        if isinstance(content, str) and content:
            merged_message["content"] += content

        tool_calls = msg.get("tool_calls")
        if tool_calls:
            merged_message["tool_calls"] = tool_calls

        for key in (
            "model",
            "created_at",
            "done",
            "done_reason",
            "total_duration",
            "load_duration",
            "prompt_eval_count",
            "prompt_eval_duration",
            "eval_count",
            "eval_duration",
        ):
            if key in chunk_dict:
                merged[key] = chunk_dict[key]

    if printed_thinking_header and OLLAMA_SHOW_THINKING:
        print()

    if merged_message["tool_calls"] is None:
        merged_message.pop("tool_calls")

    merged["message"] = merged_message
    return merged
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
                    LOGGER.debug("Reusing last output file URL: %s", fallback)
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
        LOGGER.debug("Tool requested: %s", tool_name)
        LOGGER.debug("Arguments: %s", args)

        tool_result = await execute_tool(tool_name, args)
        tool_result_for_context = _compact_tool_result_for_context(tool_result)
        LOGGER.debug("Tool result: %s", tool_result_for_context)

        messages.append(
            {
                "role": "tool",
                "tool_name": tool_name,
                "content": json.dumps(tool_result_for_context)
                if isinstance(tool_result_for_context, (dict, list))
                else str(tool_result_for_context),
            }
        )

        LOGGER.debug("Updated messages with tool result. Total messages: %s", len(messages))

        err_text = _tool_error_text(tool_result)
        if err_text:
            had_error = True
            last_err = err_text
            failed_signatures.append(call_signature)

    return had_error, last_err, failed_signatures


async def main():
    setup_readline()
    LOGGER.info("Loading MCP tools...")
    try:
        tools = await load_mcp_tools()
    except Exception as e:
        LOGGER.error("Error connecting to MCP server: %s", e)
        LOGGER.error("Fix the MCP server and run again.")
        return

    LOGGER.info("Loaded %s tools:", len(tools))
    for tool in tools:
        LOGGER.info("  - %s: %s", tool["function"]["name"], tool["function"]["description"])
    LOGGER.info("Type ':q' to quit.")

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
                response = _chat_with_optional_thinking_stream(messages, tools)
                _print_context_usage(response, OLLAMA_MODEL)
            except Exception as e:
                LOGGER.error("Error calling Ollama: %s", e)
                break
            msg = _get_message(response)
            tool_calls = msg.get("tool_calls") or []

            if not tool_calls:
                assistant_content = msg.get("content", "") or ""
                if "{" in assistant_content:
                    LOGGER.debug("Checking for inline tool calls in text...")
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
                    LOGGER.warning("Tool call had error: %s", last_err)
                    LOGGER.warning(
                        "Attempting auto-repair %s/%s",
                        attempt,
                        MAX_TOOL_REPAIR_ATTEMPTS,
                    )

                    messages.append(
                        generate_auto_fix_tool_msg(
                            last_err,
                            prior_user_text=user_msg,
                            repeated_signature=repeated_signature,
                        )
                    )

                    try:
                        repair_resp = _chat_with_optional_thinking_stream(messages, tools)
                        _print_context_usage(repair_resp, OLLAMA_MODEL)
                    except Exception as e:
                        last_err = f"Ollama error during repair: {e}"
                        LOGGER.error(last_err)
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

    LOGGER.info("Bye!")


if __name__ == "__main__":
    asyncio.run(main())
