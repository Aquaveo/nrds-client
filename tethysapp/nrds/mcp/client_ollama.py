#!/usr/bin/env python3
import asyncio
import json
import os
from typing import Dict, Any, List
import ollama
from fastmcp import Client as MCPClient
from fastmcp.client.transports import SSETransport

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
# OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "lfm2.5-thinking")
MCP_SERVER_URL = os.getenv("MCP_SERVER_URL", "http://127.0.0.1:9000/sse")

MAX_TOOL_REPAIR_ATTEMPTS = int(os.getenv("MCP_TOOL_REPAIR_ATTEMPTS", "5"))

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
            # Return raw-ish data to model; if error, include text
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

        # Accept either dict args or JSON-string args
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

        # IMPORTANT: include tool_name so Ollama can associate result correctly
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

# Step 3: Interactive conversation loop
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
        "7) If the user provides a relative date (today/yesterday), you MUST convert to ISO and then confirm it exists by calling list_available_dates(model, start=..., end=...) (or call it and pick the latest/closest). Never guess a date.\n"
        "8) If forecast is short_range,use list_available_outputs_files_short_range, if medium_range, use list_available_outputs_files_medium_range. If analysis_assim_extend, use list_available_outputs_files_analysis_assim_extend. Do not guess the cycle or ensemble; call the list tool and pick from results.\n\n"
        "Error handling:\n"
        "7) If you get \"unexpected keyword argument\", remove that argument and retry with only schema keys.\n"
        "8) If you get a schema validation error (pattern/enum/missing), fix the arguments and retry.\n"
        "9) If you get an HTTP 500/backend error, stop guessing. Try removing optional args (e.g., ensemble) and verify the combination exists by calling list_* tools.\n"
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

    # Keep conversation state
    messages = [SYSTEM_MSG]

    while True:
        user_msg = input("👤 User> ").strip()
        if not user_msg:
            continue
        if user_msg in (":q", ":quit", "quit", "exit"):
            break

        messages.append({"role": "user", "content": user_msg})

        # Loop until model stops requesting tools
        while True:
            try:
                response = ollama.chat(
                    model=OLLAMA_MODEL,
                    messages=messages,
                    think=False,
                    tools=tools,      # keep tools available every step
                    stream=False,
                )
            except Exception as e:
                print(f"❌ ERROR calling Ollama: {e}")
                break

            msg = response.get("message", {})
            tool_calls = msg.get("tool_calls") or []

            # ✅ Fallback: tool call embedded in text
            if not tool_calls:
                print("🔍 Checking for inline tool calls in text...")
                tool_calls = extract_inline_tool_calls(msg.get("content", "")) or []

            # No tool calls -> print assistant and continue outer loop
            if not tool_calls:
                print("🤖 Assistant response (no tools requested):")
                assistant_text = msg.get("content", "")
                print(f"\n🤖 Assistant:\n{assistant_text}\n")
                messages.append({"role": "assistant", "content": assistant_text})
                break

            # If tool calls -> execute them, append tool results, then continue loop
            if "tool_calls" not in msg:
                # synthesize tool_calls into the assistant message for chat history consistency
                msg["tool_calls"] = tool_calls
            messages.append(msg)

            had_error, last_err = await process_tool_calls(tool_calls, messages)

            # ✅ Auto repair loop (no user input required)
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

                            Repair rules:
                            - Use only the tool schema keys. Do NOT add unexpected arguments.
                            - If the user said a relative date (e.g., "yesterday"), convert it to YYYY-MM-DD before calling tools.
                            - If the user used ordinal terms (first/second cycle), call the appropriate list_* tool and select by ordering.
                            - If the error mentions "unexpected keyword argument", remove that key and retry.
                            - If the error is a schema validation error (missing/enum/pattern), correct the arguments.
                            - If the error is a backend HTTP 500, do not guess random dates/values. First verify existence using list_* tools; remove optional args like ensemble unless explicitly needed.

                            Now: make the next step using real tool_calls (not plain text) to progress toward the original user intent.""",
                        }
                    )
                    repair_resp = ollama.chat(
                        model=OLLAMA_MODEL,
                        messages=messages,
                        think=False,
                        tools=tools,
                        stream=False,
                    )
                    repair_msg = repair_resp.get("message", {})
                    repair_calls = repair_msg.get("tool_calls") or []
                    # breakpoint()
                    # ✅ Fallback: parse inline JSON tool call from text
                    if not repair_calls:
                        repair_calls = extract_inline_tool_calls(repair_msg.get("content", "")) or []

                    if not repair_calls:
                        # ✅ DO NOT break. Continue trying up to MAX_TOOL_REPAIR_ATTEMPTS
                        last_err = "Model did not return tool_calls; it responded with text instead."
                        continue

                    if "tool_calls" not in repair_msg:
                        repair_msg["tool_calls"] = repair_calls
                    messages.append(repair_msg)

                    had_error, last_err = await process_tool_calls(repair_calls, messages)

                    if not had_error:
                        break

                # After repair attempts, continue the main inner loop for final response
                continue

            # No errors: continue the main inner loop for final response
            continue

    print("👋 Bye!")


if __name__ == "__main__":
    asyncio.run(main())